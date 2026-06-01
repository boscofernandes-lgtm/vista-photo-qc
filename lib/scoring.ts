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

/** Map raw CV metrics into 0..1 sub-scores for the Quality pillar. */
export function computeImageScores(cv: CVMetrics): ImageScores {
  // Lighting: well-exposed mid-tones, minimal blown/crushed pixels.
  const exposure = bell(cv.brightness, 150, 55);
  const clipPenalty = clamp01(cv.clipHigh * 2.5 + cv.clipLow * 1.8);
  const lighting = clamp01(exposure * (1 - clipPenalty));

  // Angles & Frames: composition (rule of thirds) + sensible landscape aspect.
  const aspectScore = plateau(cv.aspect, 1.3, 1.9, 0.8);
  const angles = clamp01(0.7 * cv.thirds + 0.3 * aspectScore);

  // Edits: healthy contrast & saturation, neutral white balance, low noise, sharp.
  const contrastScore = bell(cv.contrast, 55, 30);
  const saturationScore = bell(cv.saturation, 0.45, 0.25);
  const wbScore = clamp01(1 - cv.colorCast);
  const noiseScore = clamp01(1 - cv.noise);
  const sharpScore = plateau(cv.sharpness, 120, 4000, 120); // soft floor on blur
  const edits = clamp01(
    0.25 * contrastScore +
      0.2 * saturationScore +
      0.2 * wbScore +
      0.15 * noiseScore +
      0.2 * sharpScore
  );

  return { lighting, angles, edits };
}

/** Hard, human-readable flags for an individual image. */
export function imageFlags(cv: CVMetrics, s: ImageScores): string[] {
  const f: string[] = [];
  if (cv.sharpness < 80) f.push("Blurry / soft focus");
  if (cv.brightness < 70) f.push("Underexposed (too dark)");
  if (cv.brightness > 205) f.push("Overexposed (too bright)");
  if (cv.clipHigh > 0.12) f.push("Blown highlights");
  if (cv.megapixels < 1.0) f.push("Low resolution");
  if (cv.colorCast > 0.5) f.push("Strong color cast");
  if (cv.noise > 0.6) f.push("Noisy / grainy");
  if (s.angles < 0.4) f.push("Weak framing / composition");
  return f;
}

const meanQuality = (s: ImageScores) => (s.lighting + s.angles + s.edits) / 3;

export function scoreProperty(analyses: ImageAnalysis[], weights: Weights): PropertyScore {
  const subScores: SubScore[] = [];
  const n = Math.max(1, analyses.length);

  // ---- Quality pillar: average each sub-score across all images ----
  const avg = (sel: (s: ImageScores) => number) =>
    analyses.reduce((a, x) => a + sel(x.scores), 0) / n;

  const qAvg = {
    lighting: avg((s) => s.lighting),
    angles: avg((s) => s.angles),
    edits: avg((s) => s.edits),
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
