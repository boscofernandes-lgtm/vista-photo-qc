"use client";

import { AIRubricResult, ImageAnalysis, ShotCategory, SubBrand } from "./types";
import { brandProfile } from "./brands";

/** Downscale an image to a small JPEG data URL to keep the Gemini payload light. */
function toSmallDataUrl(src: string, maxEdge = 512, quality = 0.7): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const CATEGORY_LABEL: Record<ShotCategory, string> = {
  cover_facade: "cover/facade",
  setups_interiors: "interior/setup",
  lifestyle: "lifestyle",
  other: "other",
};

export interface AIRubricError {
  error: string;
  status: number;
}

/**
 * Run the optional Gemini rubric pass. Sends downscaled photos to our own API
 * route (which holds the key server-side) and returns 1–5 category scores.
 */
export async function runAIRubric(
  analyses: ImageAnalysis[],
  brand: SubBrand,
  mode: "hybrid" | "full"
): Promise<AIRubricResult> {
  const profile = brandProfile(brand);

  const images = (
    await Promise.all(
      analyses.map(async (a) => {
        const dataUrl = await toSmallDataUrl(a.input.src);
        if (!dataUrl) return null;
        return {
          label: a.input.label ?? "",
          category: a.uncertain ? "other" : CATEGORY_LABEL[a.clip.top],
          dataUrl,
        };
      })
    )
  ).filter((x): x is { label: string; category: string; dataUrl: string } => x !== null);

  if (images.length === 0) {
    throw { error: "Could not read any photos to send for AI scoring.", status: 400 } as AIRubricError;
  }

  const res = await fetch("/api/airubric", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brand,
      brandName: profile.name,
      brandVibe: profile.vibe,
      mode,
      images,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw { error: data.error ?? `AI scoring failed (${res.status})`, status: res.status } as AIRubricError;
  }
  return data as AIRubricResult;
}
