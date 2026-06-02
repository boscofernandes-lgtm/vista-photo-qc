import { CVMetrics } from "./types";

/**
 * Faithful, deterministic photo correction — the same global adjustments a RAW
 * developer makes: exposure, white balance, contrast and saturation. No pixels
 * are invented, no content is added or removed. Blur and low resolution are NOT
 * fixable this way and are surfaced as reshoot-only.
 */

export interface CorrectionResult {
  blob: Blob;
  url: string;
  /** Human-readable list of the adjustments that were actually applied. */
  applied: string[];
  /** Problems that a faithful edit cannot repair (blur, low-res). */
  unfixable: string[];
  width: number;
  height: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Targets the correction math aims for — calibrated to StayVista pro photography. */
const TARGET_BRIGHTNESS = 142; // mid-tone luminance
const TARGET_CONTRAST = 60; // std-dev of luminance
const MIN_SAT = 0.34;
const MAX_SAT = 0.6;

/** Does this image have a global flaw a faithful edit can meaningfully improve? */
export function isCorrectable(cv: CVMetrics): boolean {
  return (
    cv.brightness < 120 ||
    cv.brightness > 175 ||
    cv.colorCast > 0.2 ||
    cv.contrast < 50 ||
    cv.saturation < 0.3 ||
    cv.saturation > 0.62
  );
}

/** Problems that cannot be honestly corrected and require a re-shoot. */
export function reshootOnlyReasons(cv: CVMetrics): string[] {
  const r: string[] = [];
  if (cv.sharpness < 700) r.push("soft focus / blur can't be faithfully fixed");
  if (cv.megapixels < 1.0) r.push("resolution too low to upscale honestly");
  return r;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/**
 * Develop the image: re-measure stats on the full-res pixels, then apply
 * gray-world white balance → endpoint-preserving gamma (exposure) → contrast
 * around a fixed pivot → gentle saturation. Every step is clamped so the result
 * stays a faithful rendering of the original scene.
 */
export async function correctImage(src: string, cv: CVMetrics): Promise<CorrectionResult> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const total = w * h;

  // ---- Sample stats (strided, ~200k samples max) ----
  const stride = Math.max(1, Math.floor(total / 200000));
  let n = 0;
  let lumSum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let satSum = 0;
  const lums: number[] = [];
  for (let i = 0; i < total; i += stride) {
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lumSum += l;
    rSum += r;
    gSum += g;
    bSum += b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
    lums.push(l);
    n++;
  }
  const meanLum = lumSum / n;
  const rAvg = rSum / n;
  const gAvg = gSum / n;
  const bAvg = bSum / n;
  const meanSat = satSum / n;
  let varSum = 0;
  for (let k = 0; k < lums.length; k++) {
    const d = lums[k] - meanLum;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n);

  const applied: string[] = [];

  // ---- White balance: gray-world, partial strength, clamped ----
  const chMean = (rAvg + gAvg + bAvg) / 3 || 1;
  let wbR = 1;
  let wbG = 1;
  let wbB = 1;
  if (cv.colorCast > 0.2) {
    const STRENGTH = 0.6; // pull only partway to neutral — stays faithful
    wbR = clamp(1 + STRENGTH * (chMean / (rAvg || chMean) - 1), 0.8, 1.25);
    wbG = clamp(1 + STRENGTH * (chMean / (gAvg || chMean) - 1), 0.8, 1.25);
    wbB = clamp(1 + STRENGTH * (chMean / (bAvg || chMean) - 1), 0.8, 1.25);
    applied.push("Neutralized color cast (white balance)");
  }

  // ---- Exposure: endpoint-preserving gamma toward target mid-tone ----
  let gamma = 1;
  if (meanLum < 120 || meanLum > 175) {
    gamma = clamp(
      Math.log(TARGET_BRIGHTNESS / 255) / Math.log(clamp(meanLum, 12, 243) / 255),
      0.55,
      1.7
    );
    applied.push(meanLum < 120 ? "Brightened exposure" : "Tamed over-exposure");
  }

  // ---- Contrast around a fixed pivot ----
  let contrastF = 1;
  if (std < 50) {
    contrastF = clamp(TARGET_CONTRAST / Math.max(20, std), 1, 1.35);
    applied.push("Recovered flat contrast");
  }

  // ---- Saturation: gentle pull into a natural window ----
  let satF = 1;
  if (meanSat < MIN_SAT) {
    satF = clamp(MIN_SAT / Math.max(0.05, meanSat), 1, 1.3);
    applied.push("Lifted muted colors");
  } else if (meanSat > MAX_SAT) {
    satF = clamp(MAX_SAT / meanSat, 0.78, 1);
    applied.push("Calmed over-saturation");
  }

  const pivot = TARGET_BRIGHTNESS; // contrast pivots around the target mid-tone
  const inv255 = 1 / 255;

  // Precompute a gamma LUT for speed.
  const gammaLut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    gammaLut[v] = 255 * Math.pow(v * inv255, gamma);
  }

  for (let p = 0; p < data.length; p += 4) {
    let r = data[p];
    let g = data[p + 1];
    let b = data[p + 2];

    // 1) White balance
    r *= wbR;
    g *= wbG;
    b *= wbB;
    r = clamp(r, 0, 255);
    g = clamp(g, 0, 255);
    b = clamp(b, 0, 255);

    // 2) Exposure (gamma)
    if (gamma !== 1) {
      r = gammaLut[Math.round(r)];
      g = gammaLut[Math.round(g)];
      b = gammaLut[Math.round(b)];
    }

    // 3) Contrast around pivot
    if (contrastF !== 1) {
      r = pivot + (r - pivot) * contrastF;
      g = pivot + (g - pivot) * contrastF;
      b = pivot + (b - pivot) * contrastF;
    }

    // 4) Saturation around per-pixel luminance
    if (satF !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * satF;
      g = l + (g - l) * satF;
      b = l + (b - l) * satF;
    }

    data[p] = clamp(r, 0, 255);
    data[p + 1] = clamp(g, 0, 255);
    data[p + 2] = clamp(b, 0, 255);
  }

  ctx.putImageData(imageData, 0, 0);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
      "image/jpeg",
      0.92
    )
  );
  const url = URL.createObjectURL(blob);

  if (applied.length === 0) applied.push("Already well-balanced — minor cleanup only");

  return { blob, url, applied, unfixable: reshootOnlyReasons(cv), width: w, height: h };
}
