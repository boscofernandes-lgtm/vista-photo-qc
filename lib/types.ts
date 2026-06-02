export type SourceKind = "url" | "upload";

export interface ImageInput {
  id: string;
  /** Same-origin URL the browser can read pixels from (proxied for remote images). */
  src: string;
  /** Original remote URL, if any (for display/debug). */
  originalUrl?: string;
  /** Room/space label from StayVista page data, when available. */
  label?: string;
  source: SourceKind;
}

/** Raw, deterministic computer-vision measurements for one image. */
export interface CVMetrics {
  width: number;
  height: number;
  megapixels: number;
  aspect: number;
  sharpness: number; // Laplacian variance (higher = sharper)
  brightness: number; // mean luminance 0..255
  clipLow: number; // fraction of near-black pixels
  clipHigh: number; // fraction of near-white pixels
  contrast: number; // std-dev of luminance 0..~128
  saturation: number; // mean HSV saturation 0..1
  colorCast: number; // 0 (neutral) .. 1 (strong cast)
  thirds: number; // 0..1 rule-of-thirds composition strength
  noise: number; // 0..1 estimated noise (higher = noisier)
}

/** The three Shots sub-categories from the rubric. */
export type ShotCategory = "cover_facade" | "setups_interiors" | "lifestyle" | "other";

export interface ClipResult {
  /** Probability mass aggregated into each Shots bucket. */
  buckets: Record<ShotCategory, number>;
  top: ShotCategory;
  topConfidence: number;
  /** Raw label scores for transparency. */
  raw: { label: string; score: number }[];
}

/** Per-image derived 0..1 sub-scores. */
export interface ImageScores {
  lighting: number;
  angles: number;
  edits: number;
}

export interface ImageAnalysis {
  input: ImageInput;
  cv: CVMetrics;
  clip: ClipResult;
  scores: ImageScores;
  /** True when CLIP confidence is too low to trust the category. */
  uncertain: boolean;
  flags: string[];
}

export interface Weights {
  shots: { cover: number; setups: number; lifestyle: number };
  quality: { lighting: number; angles: number; edits: number };
}

export interface SubScore {
  key: string;
  label: string;
  /** 0..max points earned. */
  points: number;
  max: number;
  detail: string;
  /** Integer 1–5 rubric band (StayVista scorecard scale, floored at 1). */
  band: number;
  /** Where this category's score came from. */
  source: "cv" | "ai";
}

/** StayVista sub-brands, each with its own pass bar and editing direction. */
export type SubBrand = "vieda" | "villas" | "veo" | "vaana" | "residences" | "grams";

/** Per-brand scoring profile: pass threshold + CV target curves (editing direction). */
export interface BrandProfile {
  id: SubBrand;
  name: string;
  /** Minimum FrameCheck score (/100) to go live for this brand. */
  minScore: number;
  /** Competitor this brand is benchmarked against. */
  comparableTo: string;
  /** One-line editing direction from the QC knowledge base. */
  vibe: string;
  /** CV curve centers tuned to this brand's editing direction. */
  targets: {
    brightnessCenter: number;
    brightnessSpread: number;
    contrastCenter: number;
    contrastSpread: number;
    saturationCenter: number;
    saturationSpread: number;
    /** Multiplier on the white-balance penalty — lower = warm cast tolerated. */
    castTolerance: number;
  };
}

/** One competitor row from the QC knowledge base benchmark table. */
export interface CompetitorBenchmark {
  brand: string;
  tier: string;
  cover: number;
  setups: number;
  lifestyle: number;
  lighting: number;
  angles: number;
  isBenchmark?: boolean;
  note: string;
}

/** Result of the optional Gemini rubric pass. */
export interface AIRubricResult {
  mode: "hybrid" | "full";
  categories: Partial<
    Record<
      "cover" | "setups" | "lifestyle" | "lighting" | "angles" | "edits",
      { score: number; reason: string }
    >
  >;
  summary: string;
}

export interface GradeBand {
  min: number;
  max: number;
  grade: string;
  solution: string;
}

export interface PropertyScore {
  total30: number;
  total100: number;
  /** Score from the integer 1–5 rubric bands, normalised to /100 (MIS scale). */
  banded100: number;
  grade: string;
  solution: string;
  shotsPillar: number; // 0..15 (or weighted max)
  qualityPillar: number; // 0..15 (or weighted max)
  subScores: SubScore[];
  reshootList: { image: ImageAnalysis; reasons: string[] }[];
  imageCount: number;
  /** Sub-brand this property was scored against. */
  brand: SubBrand;
  /** Pass threshold (/100) for that brand. */
  threshold: number;
  /** True when total100 meets the brand's minimum to go live. */
  pass: boolean;
  /** True when one or more categories were scored by the AI rubric pass. */
  aiAssisted: boolean;
  /** Short AI summary, when the Gemini pass ran. */
  aiSummary?: string;
}

/** Per-photo, listing-readiness recommendation. */
export interface PhotoVerdict {
  image: ImageAnalysis;
  /** Position in the current listing order (0-based). */
  currentIndex: number;
  verdict: "strong" | "ok" | "improve";
  note: string;
}

export interface HeroPick {
  image: ImageAnalysis;
  currentIndex: number;
  /** True when this is already the first photo on the listing. */
  isCurrentCover: boolean;
  reason: string;
}

/** A photo in the suggested running order. */
export interface OrderedShot {
  image: ImageAnalysis;
  currentIndex: number;
  /** 0-based suggested position. */
  suggestedIndex: number;
}

export interface Recommendations {
  hero: HeroPick | null;
  order: OrderedShot[];
  /** True when the suggested order differs from the current order. */
  reorderNeeded: boolean;
  verdicts: PhotoVerdict[];
  strongCount: number;
  improveCount: number;
}

export interface PropertyMeta {
  name: string;
  city?: string;
  state?: string;
  photosCount?: number;
  sourceUrl?: string;
}
