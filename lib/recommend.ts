import {
  HeroPick,
  ImageAnalysis,
  ImageScores,
  OrderedShot,
  PhotoVerdict,
  Recommendations,
  ShotCategory,
} from "./types";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const meanQuality = (s: ImageScores) => (s.lighting + s.angles + s.edits) / 3;

/** How well a category works as a listing's first impression. */
function categoryFit(cat: ShotCategory): number {
  switch (cat) {
    case "cover_facade":
      return 1; // the classic villa hero
    case "lifestyle":
      return 0.85; // pool / view / amenity hero also sells well
    case "setups_interiors":
      return 0.45;
    default:
      return 0.15;
  }
}

/** Landscape framing reads best as a cover; punish portrait / square gently. */
function landscapeFit(aspect: number): number {
  if (aspect >= 1.4 && aspect <= 1.8) return 1;
  if (aspect < 1.4) return clamp01(1 - (1.4 - aspect) / 0.6);
  return clamp01(1 - (aspect - 1.8) / 1.2);
}

function bucketOf(a: ImageAnalysis): ShotCategory {
  return a.uncertain ? "other" : a.clip.top;
}

/** 0..1 suitability of an image as the cover/hero. */
function heroScore(a: ImageAnalysis): number {
  const q = meanQuality(a.scores);
  const fit = categoryFit(bucketOf(a));
  const land = landscapeFit(a.cv.aspect);
  const res = clamp01(a.cv.megapixels / 3);
  const penalty = a.flags.length > 0 ? 0.12 * a.flags.length : 0;
  return clamp01(0.4 * q + 0.3 * fit + 0.18 * land + 0.12 * res - penalty);
}

const CATEGORY_WORD: Record<ShotCategory, string> = {
  cover_facade: "exterior",
  setups_interiors: "interior",
  lifestyle: "amenity",
  other: "photo",
};

/** One-line justification for why a photo is the recommended cover. */
function heroReason(a: ImageAnalysis): string {
  const word = CATEGORY_WORD[bucketOf(a)];
  const bits: string[] = [];
  if (a.scores.lighting >= 0.7) bits.push("bright");
  if (a.scores.edits >= 0.7) bits.push("crisp");
  if (a.scores.angles >= 0.7) bits.push("well-composed");
  if (a.cv.aspect >= 1.4 && a.cv.aspect <= 1.8) bits.push("wide-format");
  const adjectives = bits.length ? bits.slice(0, 3).join(", ") : "clean";
  return `Strongest first impression — a ${adjectives} ${word} shot that sets the tone for the listing.`;
}

/** Showcase priority used for the suggested running order (higher = earlier). */
function orderPriority(a: ImageAnalysis): number {
  const fit = categoryFit(bucketOf(a));
  const q = meanQuality(a.scores);
  const penalty = a.flags.length > 0 ? 0.4 : 0;
  return fit * 2 + q - penalty;
}

function verdictFor(a: ImageAnalysis, currentIndex: number): PhotoVerdict {
  const q = meanQuality(a.scores);
  if (a.flags.length > 0) {
    return { image: a, currentIndex, verdict: "improve", note: a.flags[0] };
  }
  if (q < 0.5) {
    return { image: a, currentIndex, verdict: "improve", note: "Low overall quality — consider re-shooting" };
  }
  if (q >= 0.75) {
    return { image: a, currentIndex, verdict: "strong", note: "Listing-ready" };
  }
  return { image: a, currentIndex, verdict: "ok", note: "Acceptable" };
}

/**
 * Derive cover/hero pick, an ideal running order, and per-photo verdicts.
 * `analyses` is assumed to be in the current listing order (StayVista gallery
 * order), so index 0 is treated as the current cover.
 */
export function recommend(analyses: ImageAnalysis[]): Recommendations {
  if (analyses.length === 0) {
    return { hero: null, order: [], reorderNeeded: false, verdicts: [], strongCount: 0, improveCount: 0 };
  }

  const indexed = analyses.map((image, currentIndex) => ({ image, currentIndex }));

  // ---- Hero pick ----
  let bestIdx = 0;
  let bestScore = -Infinity;
  indexed.forEach(({ image }, i) => {
    const s = heroScore(image);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  });
  const heroImg = indexed[bestIdx];
  const hero: HeroPick = {
    image: heroImg.image,
    currentIndex: heroImg.currentIndex,
    isCurrentCover: heroImg.currentIndex === 0,
    reason: heroReason(heroImg.image),
  };

  // ---- Suggested order: hero first, then by showcase priority ----
  const rest = indexed
    .filter((x) => x.currentIndex !== heroImg.currentIndex)
    .sort((a, b) => orderPriority(b.image) - orderPriority(a.image));
  const ordered = [heroImg, ...rest];
  const order: OrderedShot[] = ordered.map((x, suggestedIndex) => ({
    image: x.image,
    currentIndex: x.currentIndex,
    suggestedIndex,
  }));
  const reorderNeeded = order.some((o) => o.currentIndex !== o.suggestedIndex);

  // ---- Per-photo verdicts ----
  const verdicts = indexed.map(({ image, currentIndex }) => verdictFor(image, currentIndex));
  const strongCount = verdicts.filter((v) => v.verdict === "strong").length;
  const improveCount = verdicts.filter((v) => v.verdict === "improve").length;

  return { hero, order, reorderNeeded, verdicts, strongCount, improveCount };
}
