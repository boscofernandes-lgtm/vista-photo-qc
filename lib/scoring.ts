import {
  CVMetrics,
  GradeBand,
  ImageAnalysis,
  ImageScores,
  PropertyScore,
  ShotCategory,
  SubScore,
  Weights,
} from "./types";

export const DEFAULT_WEIGHTS: Weights = {
  shots: { cover: 5, setups: 5, lifestyle: 5 },
  quality: { lighting: 5, angles: 5, edits: 5 },
};

export const GRADE_BANDS: GradeBand[] = [
  { min: 0, max: 39, grade: "Below Avg", solution: "Re-shoot" },
  { min: 40, max: 59, grade: "Needs Improvement", solution: "Edit if possible or reshoot specific shots" },
  { min: 60, max: 75, grade: "Meets Expectations", solution: "Okay unless no bookings in first 7 days" },
  { min: 76, max: 89, grade: "Exceeds Expectations", solution: "No action" },
  { min: 90, max: 100, grade: "Outstanding", solution: "Set as benchmark" },
];

/**
 * Minimum CLIP confidence to trust a shot-type classification. This is the
 * fraction of total probability mass in the winning bucket; with 4 balanced
 * buckets, ~0.35 already signals a clear winner over an even 0.25 split.
 */
export const CLIP_CONFIDENCE_FLOOR = 0.35;

/** How many shots of each type a complete listing should have. */
const COVERAGE_TARGET: Record<Exclude<ShotCategory, "other">, number> = {
  cover_facade: 1,
  setups_interiors: 3,
  lifestyle: 2,
};

export function gradeFor(score100: number): GradeBand {
  const s = Math.max(0, Math.min(100, score100));
  return GRADE_BANDS.find((b) => s >= b.min && s <= b.max) ?? GRADE_BANDS[0];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Bell curve: 1.0 at center, falling to ~0 at center +/- (2*spread). */
function bell(value: number, center: number, spread: number): number {
  const d = (value - center) / spread;
  return clamp01(Math.exp(-0.5 * d * d));
}

/** Plateau: 1.0 inside [lo,hi], ramping down outside over `soft`. */
function plateau(value: number, lo: number, hi: number, soft: number): number {
  if (value >= lo && value <= hi) return 1;
  if (value < lo) return clamp01(1 - (lo - value) / soft);
  return clamp01(1 - (value - hi) / soft);
}

/**
 * Map raw CV metrics into 0..1 sub-scores for the Quality pillar.
 *
 * Curves are calibrated against real StayVista photography so the scores
 * actually spread: a crisp, bright, well-exposed pro shot lands ~0.85+, a
 * mediocre one ~0.55, and a dark/blurry/flat shot drops below ~0.4. The
 * earlier curves were far too forgiving (especially sharpness, which plateaued
 * at 1.0 for nearly everything), which compressed every property into 75–85.
 */
export function computeImageScores(cv: CVMetrics): ImageScores {
  // Lighting: well-exposed mid-tones in a tight band; punish blown/crushed pixels.
  const exposure = bell(cv.brightness, 145, 42);
  const clipPenalty = clamp01(cv.clipHigh * 3 + cv.clipLow * 2);
  const lighting = clamp01(exposure * (1 - clipPenalty));

  // Angles & Frames: composition (rule of thirds) + a sensible landscape window.
  const aspectScore = plateau(cv.aspect, 1.4, 1.85, 0.55);
  const angles = clamp01(0.7 * cv.thirds + 0.3 * aspectScore);

  // Edits: healthy contrast & saturation, neutral white balance, low noise, sharp.
  const contrastScore = bell(cv.contrast, 62, 22);
  const saturationScore = bell(cv.saturation, 0.42, 0.18);
  const wbScore = clamp01(1 - cv.colorCast * 1.3);
  const noiseScore = clamp01(1 - cv.noise * 1.2);
  // Sharpness: full credit only when the shot is genuinely crisp (Laplacian
  // variance ~1400+ at working size), ramping down through softness to blur.
  // The previous floor of 120 gave every in-focus photo a perfect 1.0.
  const sharpScore = plateau(cv.sharpness, 1400, 7000, 1400);
  const edits = clamp01(
    0.28 * contrastScore +
      0.16 * saturationScore +
      0.18 * wbScore +
      0.1 * noiseScore +
      0.28 * sharpScore
  );

  return { lighting, angles, edits };
}

/** Hard, human-readable flags for an individual image. */
export function imageFlags(cv: CVMetrics, s: ImageScores): string[] {
  const f: string[] = [];
  if (cv.sharpness < 700) f.push("Blurry / soft focus");
  if (cv.brightness < 85) f.push("Underexposed (too dark)");
  if (cv.brightness > 205) f.push("Overexposed (too bright)");
  if (cv.clipHigh > 0.12) f.push("Blown highlights");
  if (cv.megapixels < 1.0) f.push("Low resolution");
  if (cv.colorCast > 0.45) f.push("Strong color cast");
  if (cv.noise > 0.55) f.push("Noisy / grainy");
  if (s.angles < 0.4) f.push("Weak framing / composition");
  return f;
}

const meanQuality = (s: ImageScores) => (s.lighting + s.angles + s.edits) / 3;

export function scoreProperty(analyses: ImageAnalysis[], weights: Weights): PropertyScore {
  const subScores: SubScore[] = [];
  const n = Math.max(1, analyses.length);

  // ---- Quality pillar: weak-tail blend of each sub-score across all images ----
  // A listing is only as strong as its weak links, so we don't reward a high
  // average that hides several poor photos. We blend the mean with the 25th
  // percentile, pulling the score toward the weaker quarter of the set.
  const blendWeakTail = (sel: (s: ImageScores) => number) => {
    const vals = analyses.map((x) => sel(x.scores)).sort((a, b) => a - b);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const p25 = vals[Math.floor(vals.length * 0.25)] ?? mean;
    return 0.6 * mean + 0.4 * p25;
  };

  const qAvg = {
    lighting: blendWeakTail((s) => s.lighting),
    angles: blendWeakTail((s) => s.angles),
    edits: blendWeakTail((s) => s.edits),
  };

  const qualitySubs: SubScore[] = [
    {
      key: "lighting",
      label: "Lighting",
      points: qAvg.lighting * weights.quality.lighting,
      max: weights.quality.lighting,
      detail: `Avg exposure quality across ${analyses.length} photos`,
    },
    {
      key: "angles",
      label: "Angles & Frames",
      points: qAvg.angles * weights.quality.angles,
      max: weights.quality.angles,
      detail: "Composition (rule of thirds) & framing",
    },
    {
      key: "edits",
      label: "Edits",
      points: qAvg.edits * weights.quality.edits,
      max: weights.quality.edits,
      detail: "Contrast, color, white balance, noise & sharpness",
    },
  ];

  // ---- Shots pillar: coverage = enough good shots of each required type ----
  const bucketOf = (a: ImageAnalysis): ShotCategory =>
    a.uncertain ? "other" : a.clip.top;

  const coverageSub = (
    cat: Exclude<ShotCategory, "other">,
    key: string,
    label: string,
    weight: number
  ): SubScore => {
    const imgs = analyses.filter((a) => bucketOf(a) === cat);
    if (imgs.length === 0) {
      return { key, label, points: 0, max: weight, detail: `No ${label.toLowerCase()} shots detected` };
    }
    const countScore = clamp01(imgs.length / COVERAGE_TARGET[cat]);
    const qualScore = imgs.reduce((a, x) => a + meanQuality(x.scores), 0) / imgs.length;
    const cat01 = clamp01(0.5 * countScore + 0.5 * qualScore);
    return {
      key,
      label,
      points: cat01 * weight,
      max: weight,
      detail: `${imgs.length} shot(s), avg quality ${(qualScore * 100).toFixed(0)}%`,
    };
  };

  const shotsSubs: SubScore[] = [
    coverageSub("cover_facade", "cover", "Cover & Facade", weights.shots.cover),
    coverageSub("setups_interiors", "setups", "Set ups (Food & Interiors)", weights.shots.setups),
    coverageSub("lifestyle", "lifestyle", "Lifestyle (Service, Guest, Experiences)", weights.shots.lifestyle),
  ];

  subScores.push(...shotsSubs, ...qualitySubs);

  const shotsPillar = shotsSubs.reduce((a, s) => a + s.points, 0);
  const qualityPillar = qualitySubs.reduce((a, s) => a + s.points, 0);
  const earned = shotsPillar + qualityPillar;
  const maxPoints = subScores.reduce((a, s) => a + s.max, 0) || 1;
  const total100 = (earned / maxPoints) * 100;
  const band = gradeFor(total100);

  // ---- Reshoot list: images dragging the score down ----
  const reshootList = analyses
    .map((a) => ({ image: a, reasons: a.flags }))
    .filter((r) => r.reasons.length > 0 || meanQuality(r.image.scores) < 0.5)
    .map((r) => ({
      image: r.image,
      reasons: r.reasons.length ? r.reasons : ["Low overall quality score"],
    }))
    .sort((a, b) => meanQuality(a.image.scores) - meanQuality(b.image.scores));

  return {
    total30: earned,
    total100: Math.round(total100),
    grade: band.grade,
    solution: band.solution,
    shotsPillar,
    qualityPillar,
    subScores,
    reshootList,
    imageCount: analyses.length,
  };
}
