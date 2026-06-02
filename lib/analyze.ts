"use client";

import { categoryFromLabel, classifyShot } from "./clip";
import { analyzeImageData, WORKING_SIZE } from "./cv";
import { CLIP_CONFIDENCE_FLOOR, computeImageScores, imageFlags } from "./scoring";
import { ClipResult, ImageAnalysis, ImageInput, ShotCategory } from "./types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
    // Don't let a single stuck image stall the whole batch forever.
    setTimeout(() => reject(new Error(`Timed out loading image: ${src}`)), 30000);
  });
}

const ZERO_BUCKETS: Record<ShotCategory, number> = {
  cover_facade: 0,
  setups_interiors: 0,
  lifestyle: 0,
  other: 0,
};

/** Build a ClipResult straight from an authoritative category (no model needed). */
function clipFromCategory(cat: ShotCategory, confidence: number): ClipResult {
  return { buckets: { ...ZERO_BUCKETS, [cat]: confidence }, top: cat, topConfidence: confidence, raw: [] };
}

/** Race a promise against a timeout so a hung/failed CLIP run can't block results. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("CLIP timed out")), ms)),
  ]);
}

function toWorkingImageData(img: HTMLImageElement): ImageData {
  const scale = Math.min(1, WORKING_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export interface AnalyzeProgress {
  done: number;
  total: number;
  current?: string;
}

/**
 * Analyze one image: deterministic CV metrics (always) + shot classification.
 *
 * Classification is label-first: when StayVista gives us an authoritative room
 * label (Exterior, Jacuzzi, Living room…) we use it directly and never touch the
 * heavy CLIP model. CLIP is only a fallback for unlabeled/generic photos, and it
 * runs best-effort with a timeout so a slow/failed model download can never zero
 * out the whole report — the CV-based quality scores always come through.
 */
export async function analyzeOne(input: ImageInput): Promise<ImageAnalysis> {
  const img = await loadImage(input.src);
  const id = toWorkingImageData(img);
  const cv = analyzeImageData(
    id.data,
    id.width,
    id.height,
    img.naturalWidth,
    img.naturalHeight
  );
  const scores = computeImageScores(cv);
  const flags = imageFlags(cv, scores);

  const labelCat = categoryFromLabel(input.label);
  let clip: ClipResult;
  let uncertain: boolean;

  if (labelCat) {
    // Authoritative label → trust it, skip the model entirely.
    clip = clipFromCategory(labelCat, 0.99);
    uncertain = false;
  } else {
    // No usable label: try CLIP, but degrade gracefully if it's unavailable.
    try {
      clip = await withTimeout(classifyShot(input.src), 25000);
      uncertain = clip.topConfidence < CLIP_CONFIDENCE_FLOOR;
    } catch {
      clip = clipFromCategory("other", 0);
      uncertain = true; // unknown type — kept out of coverage credit, still scored on quality
    }
  }

  return { input, cv, clip, scores, uncertain, flags };
}

/**
 * Analyze a batch with bounded concurrency. Running several images at once
 * overlaps their network fetch + decode + CV, which is dramatically faster than
 * the old one-at-a-time loop on large galleries. CV always succeeds;
 * classification degrades gracefully. Results preserve input order.
 */
export async function analyzeBatch(
  inputs: ImageInput[],
  onProgress?: (p: AnalyzeProgress) => void,
  concurrency = 5
): Promise<ImageAnalysis[]> {
  const results: (ImageAnalysis | undefined)[] = new Array(inputs.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= inputs.length) break;
      try {
        results[i] = await analyzeOne(inputs[i]);
      } catch {
        // Only truly unreadable images (failed decode) are skipped.
      }
      done++;
      onProgress?.({ done, total: inputs.length, current: inputs[i].label });
    }
  }

  onProgress?.({ done: 0, total: inputs.length });
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker());
  await Promise.all(workers);
  onProgress?.({ done: inputs.length, total: inputs.length });
  return results.filter((r): r is ImageAnalysis => r !== undefined);
}
