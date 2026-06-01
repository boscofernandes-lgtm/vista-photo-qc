"use client";

import { categoryFromLabel, classifyShot } from "./clip";
import { analyzeImageData, WORKING_SIZE } from "./cv";
import { CLIP_CONFIDENCE_FLOOR, computeImageScores, imageFlags } from "./scoring";
import { ClipResult, ImageAnalysis, ImageInput } from "./types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
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

/** Analyze one image: CV metrics + CLIP shot classification + derived scores. */
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
  const rawClip = await classifyShot(input.src);

  // Prefer the scraped room label (authoritative) over CLIP when we have one.
  const labelCat = categoryFromLabel(input.label);
  const clip: ClipResult = labelCat
    ? { ...rawClip, top: labelCat, topConfidence: Math.max(rawClip.topConfidence, 0.99) }
    : rawClip;

  const scores = computeImageScores(cv);
  const flags = imageFlags(cv, scores);
  const uncertain = clip.topConfidence < CLIP_CONFIDENCE_FLOOR;
  return { input, cv, clip, scores, uncertain, flags };
}

/** Analyze a batch sequentially (CLIP is heavy; keeps memory + UI predictable). */
export async function analyzeBatch(
  inputs: ImageInput[],
  onProgress?: (p: AnalyzeProgress) => void
): Promise<ImageAnalysis[]> {
  const results: ImageAnalysis[] = [];
  for (let i = 0; i < inputs.length; i++) {
    onProgress?.({ done: i, total: inputs.length, current: inputs[i].label });
    try {
      results.push(await analyzeOne(inputs[i]));
    } catch {
      // Skip unreadable images rather than failing the whole run.
    }
  }
  onProgress?.({ done: inputs.length, total: inputs.length });
  return results;
}
