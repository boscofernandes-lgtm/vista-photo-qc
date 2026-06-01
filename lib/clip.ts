"use client";

import { ClipResult, ShotCategory } from "./types";

/**
 * Candidate prompts fed to CLIP, each mapped to a Shots-pillar bucket.
 * Buckets are kept balanced (3 prompts each) so summed probability mass isn't
 * biased toward whichever bucket happens to have more candidate labels.
 */
const LABELS: { label: string; bucket: ShotCategory }[] = [
  { label: "a wide exterior photo of a house and its garden", bucket: "cover_facade" },
  { label: "the outside view of a building", bucket: "cover_facade" },
  { label: "an aerial photo of a property", bucket: "cover_facade" },

  { label: "an indoor photo of a furnished bedroom", bucket: "setups_interiors" },
  { label: "an indoor photo of a living room or kitchen", bucket: "setups_interiors" },
  { label: "an indoor photo of a bathroom or dining table", bucket: "setups_interiors" },

  { label: "a photo of a swimming pool or hot tub", bucket: "lifestyle" },
  { label: "a photo of people relaxing on vacation", bucket: "lifestyle" },
  { label: "a photo of an outdoor dining or seating experience", bucket: "lifestyle" },

  { label: "a close-up photo of a small object", bucket: "other" },
  { label: "a photo of a sign, logo or text", bucket: "other" },
  { label: "a blurry or empty photo", bucket: "other" },
];

/**
 * Map a scraped room/space label (e.g. "Bedroom 1", "Kitchen", "Lawn") to a
 * Shots bucket. This is far more reliable than CLIP when StayVista already tells
 * us what the room is, so we use it as an authoritative prior. Returns null when
 * the label is generic (e.g. "Gallery") and CLIP should decide.
 */
export function categoryFromLabel(label?: string): ShotCategory | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/gallery|photo|image|^\s*$/.test(s)) return null;
  if (/facade|exterior|elevation|entrance|front|outside|building/.test(s))
    return "cover_facade";
  if (/pool|lawn|garden|outdoor|deck|terrace|balcony|view|lifestyle|experience/.test(s))
    return "lifestyle";
  if (
    /bed|living|kitchen|bath|wash|dining|dinning|hall|room|interior|lounge|study|kids|master|suite/.test(
      s
    )
  )
    return "setups_interiors";
  return null;
}

const CANDIDATE_LABELS = LABELS.map((l) => l.label);
const LABEL_TO_BUCKET = new Map(LABELS.map((l) => [l.label, l.bucket]));

type Classifier = (image: string, labels: string[]) => Promise<{ label: string; score: number }[]>;

let classifierPromise: Promise<Classifier> | null = null;

/**
 * Lazily build the CLIP zero-shot pipeline.
 *
 * IMPORTANT: do NOT use the q8 (model_quantized.onnx) build. The int8-quantized
 * vision encoder for this model produces a *constant* image embedding in
 * transformers.js (verified on both WebGPU and WASM) — every image, even solid
 * colors, returns identical scores, so every shot gets misclassified. We must
 * use a precision-preserving dtype (fp16 on GPU, fp32 elsewhere).
 *
 * We try candidates in order and keep the first that builds, so GPU machines get
 * the smaller/faster fp16 model while everything else falls back to correct fp32.
 */
async function getClassifier(): Promise<Classifier> {
  if (classifierPromise) return classifierPromise;
  classifierPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;

    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    const candidates: { device: "webgpu" | "wasm"; dtype: "fp16" | "fp32" }[] = hasWebGPU
      ? [
          { device: "webgpu", dtype: "fp16" },
          { device: "webgpu", dtype: "fp32" },
          { device: "wasm", dtype: "fp32" },
        ]
      : [{ device: "wasm", dtype: "fp32" }];

    let pipe: any;
    let lastErr: unknown;
    for (const c of candidates) {
      try {
        pipe = await pipeline(
          "zero-shot-image-classification",
          "Xenova/clip-vit-base-patch32",
          { device: c.device, dtype: c.dtype }
        );
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!pipe) throw lastErr ?? new Error("Failed to build CLIP pipeline");
    return (image, labels) => pipe(image, labels) as ReturnType<Classifier>;
  })();
  return classifierPromise;
}

/** Warm the model so the first real classification isn't slow on stage. */
export async function warmupClip(): Promise<void> {
  await getClassifier();
}

export async function classifyShot(imageSrc: string): Promise<ClipResult> {
  const classifier = await getClassifier();
  const raw = await classifier(imageSrc, CANDIDATE_LABELS);

  const buckets: Record<ShotCategory, number> = {
    cover_facade: 0,
    setups_interiors: 0,
    lifestyle: 0,
    other: 0,
  };
  for (const r of raw) {
    const bucket = LABEL_TO_BUCKET.get(r.label) ?? "other";
    buckets[bucket] += r.score;
  }

  let top: ShotCategory = "other";
  let topConfidence = 0;
  (Object.keys(buckets) as ShotCategory[]).forEach((k) => {
    if (buckets[k] > topConfidence) {
      topConfidence = buckets[k];
      top = k;
    }
  });

  return { buckets, top, topConfidence, raw };
}
