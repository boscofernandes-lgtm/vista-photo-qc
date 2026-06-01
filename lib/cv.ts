import { CVMetrics } from "./types";

/**
 * Deterministic image-quality metrics computed from pixel data.
 * `rgba` is expected at a normalized working size (see WORKING_SIZE) so that
 * blur/sharpness thresholds are resolution-independent. Resolution-dependent
 * facts (megapixels, aspect) come from the natural dimensions.
 */
export const WORKING_SIZE = 512;

export function analyzeImageData(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  naturalW: number,
  naturalH: number
): CVMetrics {
  const n = w * h;
  const lum = new Float32Array(n);

  let sum = 0;
  let clipLow = 0;
  let clipHigh = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let satSum = 0;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = l;
    sum += l;
    if (l < 16) clipLow++;
    if (l > 239) clipHigh++;
    rSum += r;
    gSum += g;
    bSum += b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
  }

  const brightness = sum / n;

  // contrast = std-dev of luminance
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = lum[i] - brightness;
    varSum += d * d;
  }
  const contrast = Math.sqrt(varSum / n);

  // white-balance / color cast via gray-world assumption
  const rAvg = rSum / n;
  const gAvg = gSum / n;
  const bAvg = bSum / n;
  const chMean = (rAvg + gAvg + bAvg) / 3 || 1;
  const colorCast = Math.min(
    1,
    (Math.abs(rAvg - chMean) + Math.abs(gAvg - chMean) + Math.abs(bAvg - chMean)) /
      (chMean * 1.5)
  );

  // sharpness: variance of the Laplacian response
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  // noise: residual vs local 3x3 mean (speckle estimate)
  let noiseSum = 0;
  let noiseCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        lum[idx - 1] +
        lum[idx + 1] +
        lum[idx - w] +
        lum[idx + w] -
        4 * lum[idx];
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount++;

      const mean9 =
        (lum[idx - w - 1] + lum[idx - w] + lum[idx - w + 1] +
          lum[idx - 1] + lum[idx] + lum[idx + 1] +
          lum[idx + w - 1] + lum[idx + w] + lum[idx + w + 1]) / 9;
      noiseSum += Math.abs(lum[idx] - mean9);
      noiseCount++;
    }
  }
  const lapMean = lapSum / Math.max(1, lapCount);
  const sharpness = lapSqSum / Math.max(1, lapCount) - lapMean * lapMean;
  const noise = Math.min(1, noiseSum / Math.max(1, noiseCount) / 18);

  // rule-of-thirds: gradient energy concentrated near the third lines
  const thirds = ruleOfThirds(lum, w, h);

  return {
    width: naturalW,
    height: naturalH,
    megapixels: (naturalW * naturalH) / 1e6,
    aspect: naturalH === 0 ? 1 : naturalW / naturalH,
    sharpness,
    brightness,
    clipLow: clipLow / n,
    clipHigh: clipHigh / n,
    contrast,
    saturation: satSum / n,
    colorCast,
    thirds,
    noise,
  };
}

function ruleOfThirds(lum: Float32Array, w: number, h: number): number {
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  const vx1 = w / 3;
  const vx2 = (2 * w) / 3;
  const hy1 = h / 3;
  const hy2 = (2 * h) / 3;

  let nearEnergy = 0;
  let totalEnergy = 0;
  let nearPixels = 0;
  let totalPixels = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx = lum[idx + 1] - lum[idx - 1];
      const gy = lum[idx + w] - lum[idx - w];
      const mag = Math.abs(gx) + Math.abs(gy);
      totalEnergy += mag;
      totalPixels++;
      const nearV = Math.abs(x - vx1) < band || Math.abs(x - vx2) < band;
      const nearH = Math.abs(y - hy1) < band || Math.abs(y - hy2) < band;
      if (nearV || nearH) {
        nearEnergy += mag;
        nearPixels++;
      }
    }
  }
  if (totalEnergy === 0 || nearPixels === 0) return 0;
  // Compare actual edge density on the third-lines to what we'd expect if edges
  // were spread uniformly. concentration ~1 means no special emphasis; >1 means
  // subject/horizon sits on the lines. Map ~[0.85, 1.6] onto a 0..1 score so
  // typical photos land mid-range instead of saturating.
  const expected = nearPixels / totalPixels;
  const actual = nearEnergy / totalEnergy;
  const concentration = actual / expected;
  return Math.max(0, Math.min(1, (concentration - 0.85) / 0.75));
}
