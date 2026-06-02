import { BrandProfile, CompetitorBenchmark, SubBrand } from "./types";

/**
 * Sub-brand profiles, straight from the StayVista Photography QC Knowledge Base
 * (§06 sub-brand standards + §7.2 editing direction by category). Each brand has
 * its own pass bar and its own "look", so the CV curves shift per brand:
 *  - Vieda (uber-luxury): rich, warm HDR, magazine quality — Lohono target.
 *  - Villas: golden-hour warm, SaffronStays baseline.
 *  - Veo / Residences: bright & airy, clean neutral whites — Elivaas-comparable.
 *  - Vaana: minimalist, serene, soft contrast, no heavy HDR.
 *  - Gram's: nostalgic, warm filmic, popped greens/blues, social-first.
 */
export const BRAND_PROFILES: Record<SubBrand, BrandProfile> = {
  vieda: {
    id: "vieda",
    name: "Vieda (uber-luxury)",
    minScore: 85,
    comparableTo: "Lohono Stays",
    vibe: "Rich HDR, warm glow, magazine quality. Full F&B editorial styling.",
    targets: {
      brightnessCenter: 142,
      brightnessSpread: 40,
      contrastCenter: 68,
      contrastSpread: 22,
      saturationCenter: 0.46,
      saturationSpread: 0.18,
      castTolerance: 1.0, // warm grade is desired
    },
  },
  villas: {
    id: "villas",
    name: "StayVista Villas",
    minScore: 70,
    comparableTo: "SaffronStays",
    vibe: "Golden-hour preferred, full facade, warm consistent grade.",
    targets: {
      brightnessCenter: 145,
      brightnessSpread: 42,
      contrastCenter: 62,
      contrastSpread: 22,
      saturationCenter: 0.42,
      saturationSpread: 0.18,
      castTolerance: 1.2,
    },
  },
  veo: {
    id: "veo",
    name: "Veo",
    minScore: 65,
    comparableTo: "Elivaas",
    vibe: "Clean, bright, well-lit modern rooms. Neutral whites.",
    targets: {
      brightnessCenter: 155,
      brightnessSpread: 42,
      contrastCenter: 58,
      contrastSpread: 24,
      saturationCenter: 0.4,
      saturationSpread: 0.18,
      castTolerance: 1.5, // neutral
    },
  },
  vaana: {
    id: "vaana",
    name: "Vaana (lean luxury / glamping)",
    minScore: 65,
    comparableTo: "SaffronStays (outdoor)",
    vibe: "Minimalist, serene, soft contrast, raw & organic — no heavy HDR.",
    targets: {
      brightnessCenter: 146,
      brightnessSpread: 44,
      contrastCenter: 52,
      contrastSpread: 24,
      saturationCenter: 0.38,
      saturationSpread: 0.18,
      castTolerance: 1.3,
    },
  },
  residences: {
    id: "residences",
    name: "Residences",
    minScore: 65,
    comparableTo: "Elivaas",
    vibe: "Bright & airy, +0.3 stops, clean neutral whites, natural sunlight.",
    targets: {
      brightnessCenter: 162,
      brightnessSpread: 42,
      contrastCenter: 56,
      contrastSpread: 24,
      saturationCenter: 0.38,
      saturationSpread: 0.18,
      castTolerance: 1.6, // strict neutral whites
    },
  },
  grams: {
    id: "grams",
    name: "Gram's",
    minScore: 65,
    comparableTo: "The Hosteller (social-first)",
    vibe: "Nostalgic, warm filmic vintage-modern, popped greens & blues.",
    targets: {
      brightnessCenter: 148,
      brightnessSpread: 44,
      contrastCenter: 56,
      contrastSpread: 26,
      saturationCenter: 0.5,
      saturationSpread: 0.2,
      castTolerance: 1.0, // warm filmic
    },
  },
};

export const DEFAULT_BRAND: SubBrand = "villas";

/** Base profile = StayVista Villas, used when no brand-specific tuning is needed. */
export const BASE_TARGETS = BRAND_PROFILES.villas.targets;

export function brandProfile(b: SubBrand): BrandProfile {
  return BRAND_PROFILES[b] ?? BRAND_PROFILES[DEFAULT_BRAND];
}

/**
 * Competitor photo-quality benchmarks from the QC Knowledge Base (§03). Scores
 * are the observable photography standard across each brand's live listings,
 * used as calibration anchors.
 */
export const COMPETITORS: CompetitorBenchmark[] = [
  {
    brand: "Lohono Stays",
    tier: "Ultra-luxury",
    cover: 5,
    setups: 5,
    lifestyle: 5,
    lighting: 5,
    angles: 5,
    isBenchmark: true,
    note: "Benchmark. Drone + twilight mandatory, architect-level composition, full F&B editorial styling.",
  },
  {
    brand: "amã Stays & Trails (Taj)",
    tier: "Heritage luxury",
    cover: 5,
    setups: 4,
    lifestyle: 5,
    lighting: 5,
    angles: 4,
    note: "Heritage, story-led. Every shot tells a cultural narrative; warm golden lighting throughout.",
  },
  {
    brand: "SaffronStays",
    tier: "Premium lifestyle",
    cover: 4,
    setups: 4,
    lifestyle: 4,
    lighting: 4,
    angles: 4,
    note: "Current baseline target. Strong F&B presentation; lifestyle well-executed.",
  },
  {
    brand: "Elivaas",
    tier: "Modern luxury",
    cover: 4,
    setups: 4,
    lifestyle: 3,
    lighting: 4,
    angles: 4,
    note: "Clean modern aesthetic across 620 villas; weaker on lifestyle & F&B styling.",
  },
  {
    brand: "StayVista",
    tier: "Premium-luxury",
    cover: 4,
    setups: 3,
    lifestyle: 3,
    lighting: 3,
    angles: 4,
    note: "Today. Gaps: F&B setups and lifestyle shots; strong drone coverage & angles.",
  },
  {
    brand: "The Hosteller",
    tier: "Boutique hostel",
    cover: 3,
    setups: 3,
    lifestyle: 4,
    lighting: 3,
    angles: 3,
    note: "Different segment; best-in-class lifestyle & community storytelling.",
  },
];
