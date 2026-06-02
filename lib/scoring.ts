import {
  AIRubricResult,
  CVMetrics,
  GradeBand,
  ImageAnalysis,
  ImageScores,
  PropertyScore,
  ShotCategory,
  SubBrand,
  SubScore,
  Weights,
} from "./types";
import { BASE_TARGETS, brandProfile, DEFAULT_BRAND } from "./brands";

type Targets = typeof BASE_TARGETS;
type CatKey = "cover" | "setups" | "lifestyle" | "lighting" | "angles" | "edits";

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
 * Map a 0..1 sub-score onto the StayVista 1–5 rubric band (floored at 1, the way
 * a human QC scorer fills the scorecard).
 */
export function band1to5(x01: number): number {
  const s = clamp01(x01);
  if (s >= 0.85) return 5;
  if (s >= 0.66) return 4;
  if (s >= 0.48) return 3;
  if (s >= 0.28) return 2;
  return 1;
}

/**
 * Map raw CV metrics into 0..1 sub-scores for the Quality pillar, using the
 * brand's editing-direction targets (e.g. Residences is brighter & more neutral,
 * Vieda is warmer & higher-contrast). Curves are calibrated against real
 * StayVista photography so the scores actually spread.
 */
export function computeImageScores(cv: CVMetrics, targets: Targets = BASE_TARGETS): ImageScores {
  // Lighting: well-exposed mid-tones in a tight band; punish blown/crushed pixels.
  const exposure = bell(cv.brightness, targets.brightnessCenter, targets.brightnessSpread);
  const clipPenalty = clamp01(cv.clipHigh * 3 + cv.clipLow * 2);
  const lighting = clamp01(exposure * (1 - clipPenalty));

  // Angles & Frames: composition (rule of thirds) + a sensible landscape window.
  const aspectScore = plateau(cv.aspect, 1.4, 1.85, 0.55);
  const angles = clamp01(0.7 * cv.thirds + 0.3 * aspectScore);

  // Edits: healthy contrast & saturation, neutral-or-warm WB (per brand), low noise, sharp.
  const contrastScore = bell(cv.contrast, targets.contrastCenter, targets.contrastSpread);
  const saturationScore = bell(cv.saturation, targets.saturationCenter, targets.saturationSpread);
  const wbScore = clamp01(1 - cv.colorCast * targets.castTolerance);
  const noiseScore = clamp01(1 - cv.noise * 1.2);
  // Sharpness: full credit only when genuinely crisp (~1400+), ramping from soft.
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

export interface ScoreOptions {
  brand?: SubBrand;
  ai?: AIRubricResult | null;
}

export function scoreProperty(
  analyses: ImageAnalysis[],
  weights: Weights,
  opts: ScoreOptions = {}
): PropertyScore {
  const brand = opts.brand ?? DEFAULT_BRAND;
  const profile = brandProfile(brand);
  const targets = profile.targets;
  const aiCats = opts.ai?.categories ?? {};

  // Re-score every image against the selected brand's curves so switching the
  // sub-brand selector updates the report instantly (no re-analysis needed).
  const scored = analyses.map((a) => ({ a, s: computeImageScores(a.cv, targets) }));

  // ---- Quality pillar: weak-tail blend of each sub-score across all images ----
  // A listing is only as strong as its weak links, so we don't reward a high
  // average that hides several poor photos. We blend the mean with the 25th
  // percentile, pulling the score toward the weaker quarter of the set.
  const blendWeakTail = (sel: (s: ImageScores) => number) => {
    const vals = scored.map((x) => sel(x.s)).sort((a, b) => a - b);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const p25 = vals[Math.floor(vals.length * 0.25)] ?? mean;
    return 0.6 * mean + 0.4 * p25;
  };

  const qAvg = {
    lighting: blendWeakTail((s) => s.lighting),
    angles: blendWeakTail((s) => s.angles),
    edits: blendWeakTail((s) => s.edits),
  };

  // Build a sub-score, honouring an AI override for that category when present.
  const make = (
    key: CatKey,
    label: string,
    cv01: number,
    max: number,
    cvDetail: string
  ): SubScore => {
    const ov = aiCats[key];
    if (ov) {
      const x01 = clamp01((ov.score - 1) / 4);
      return {
        key,
        label,
        points: x01 * max,
        max,
        detail: ov.reason || "AI rubric score",
        band: Math.round(Math.max(1, Math.min(5, ov.score))),
        source: "ai",
      };
    }
    return { key, label, points: cv01 * max, max, detail: cvDetail, band: band1to5(cv01), source: "cv" };
  };

  // ---- Shots pillar: coverage = enough good shots of each required type ----
  const bucketOf = (a: ImageAnalysis): ShotCategory => (a.uncertain ? "other" : a.clip.top);

  const coverage01 = (cat: Exclude<ShotCategory, "other">): { cv01: number; detail: string } => {
    const imgs = scored.filter((x) => bucketOf(x.a) === cat);
    if (imgs.length === 0) return { cv01: 0, detail: `No shots of this type detected` };
    const countScore = clamp01(imgs.length / COVERAGE_TARGET[cat]);
    const qualScore = imgs.reduce((a, x) => a + meanQuality(x.s), 0) / imgs.length;
    const cv01 = clamp01(0.5 * countScore + 0.5 * qualScore);
    return { cv01, detail: `${imgs.length} shot(s), avg quality ${(qualScore * 100).toFixed(0)}%` };
  };

  const cov = coverage01("cover_facade");
  const setu = coverage01("setups_interiors");
  const life = coverage01("lifestyle");

  const shotsSubs: SubScore[] = [
    make("cover", "Cover & Facade", cov.cv01, weights.shots.cover, cov.detail),
    make("setups", "Set ups (Food & Interiors)", setu.cv01, weights.shots.setups, setu.detail),
    make("lifestyle", "Lifestyle (Service, Guest, Experiences)", life.cv01, weights.shots.lifestyle, life.detail),
  ];

  const qualitySubs: SubScore[] = [
    make("lighting", "Lighting", qAvg.lighting, weights.quality.lighting, `Avg exposure quality across ${analyses.length} photos`),
    make("angles", "Angles & Frames", qAvg.angles, weights.quality.angles, "Composition (rule of thirds) & framing"),
    make("edits", "Edits", qAvg.edits, weights.quality.edits, "Contrast, color, white balance, noise & sharpness"),
  ];

  const subScores: SubScore[] = [...shotsSubs, ...qualitySubs];

  const shotsPillar = shotsSubs.reduce((a, s) => a + s.points, 0);
  const qualityPillar = qualitySubs.reduce((a, s) => a + s.points, 0);
  const earned = shotsPillar + qualityPillar;
  const maxPoints = subScores.reduce((a, s) => a + s.max, 0) || 1;
  const total100 = (earned / maxPoints) * 100;

  // Integer 1–5 rubric scorecard, normalised to /100 (the MIS scale).
  const bandSum = subScores.reduce((a, s) => a + s.band, 0);
  const banded100 = (bandSum / (subScores.length * 5)) * 100;

  const band = gradeFor(total100);
  const threshold = profile.minScore;

  // ---- Reshoot list: images dragging the score down ----
  const reshootList = scored
    .map(({ a, s }) => ({ image: a, reasons: imageFlags(a.cv, s), s }))
    .filter((r) => r.reasons.length > 0 || meanQuality(r.s) < 0.5)
    .map((r) => ({
      image: r.image,
      reasons: r.reasons.length ? r.reasons : ["Low overall quality score"],
      s: r.s,
    }))
    .sort((a, b) => meanQuality(a.s) - meanQuality(b.s))
    .map(({ image, reasons }) => ({ image, reasons }));

  return {
    total30: earned,
    total100: Math.round(total100),
    banded100: Math.round(banded100),
    grade: band.grade,
    solution: band.solution,
    shotsPillar,
    qualityPillar,
    subScores,
    reshootList,
    imageCount: analyses.length,
    brand,
    threshold,
    pass: Math.round(total100) >= threshold,
    aiAssisted: Object.keys(aiCats).length > 0,
    aiSummary: opts.ai?.summary,
  };
}
