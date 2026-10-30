"use client";

import { zipSync } from "fflate";

/**
 * StayVista website standard: every listing photo is at most 499 KB. Counted
 * as 499,000 bytes so the file also reads as "499 KB or less" on Windows,
 * which shows sizes in 1,024-byte units.
 */
export const MAX_PHOTO_BYTES = 499_000;

/** Highest and lowest JPEG quality tried before the photo is scaled down instead. */
const BEST_QUALITY = 0.92;
const LOWEST_QUALITY = 0.6;
/** Each scale-down step keeps this share of the width and height. */
const SCALE_STEP = 0.85;

export interface SizedPhoto {
  blob: Blob;
  /** False when the original file was already a small enough JPEG and was kept as-is. */
  recompressed: boolean;
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn’t encode the photo."))), "image/jpeg", quality)
  );
}

/**
 * Fetch a photo (same-origin URL: proxied CDN photo or a local blob) and return
 * a JPEG of at most `maxBytes`. A JPEG that already fits is kept byte for byte.
 * Otherwise it is re-encoded at the highest quality that fits; only if even
 * LOWEST_QUALITY is too big is it scaled down, step by step.
 */
export async function photoUnderLimit(src: string, maxBytes = MAX_PHOTO_BYTES): Promise<SizedPhoto> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Couldn’t download the photo (${res.status}).`);
  const original = await res.blob();
  if (/^image\/jpe?g$/i.test(original.type) && original.size <= maxBytes) {
    return { blob: original, recompressed: false };
  }

  const bitmap = await createImageBitmap(original);
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    for (let step = 0; step < 12 && w >= 16 && h >= 16; step++) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas isn’t available.");
      ctx.fillStyle = "#ffffff"; // transparent PNG areas become white, not black
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);

      const top = await encodeJpeg(canvas, BEST_QUALITY);
      if (top.size <= maxBytes) return { blob: top, recompressed: true };

      // Binary-search the highest quality that fits.
      let lo = LOWEST_QUALITY;
      let hi = BEST_QUALITY;
      let best: Blob | null = null;
      const floor = await encodeJpeg(canvas, LOWEST_QUALITY);
      if (floor.size <= maxBytes) {
        best = floor;
        for (let i = 0; i < 6; i++) {
          const q = (lo + hi) / 2;
          const b = await encodeJpeg(canvas, q);
          if (b.size <= maxBytes) {
            best = b;
            lo = q;
          } else {
            hi = q;
          }
        }
        return { blob: best, recompressed: true };
      }
      w = Math.round(w * SCALE_STEP);
      h = Math.round(h * SCALE_STEP);
    }
    throw new Error("Couldn’t get the photo under the size limit.");
  } finally {
    bitmap.close();
  }
}

/** File-name-safe text: "Swimming Pool" -> "Swimming-Pool", "IMG_8453.jpg" -> "IMG_8453". */
export function fileSlug(label: string | null | undefined): string {
  const base = (label ?? "").replace(/\.(jpe?g|png|webp|heic|heif|gif|tiff?|bmp|avif)$/i, "");
  const slug = base
    .trim()
    .replace(/[^a-z0-9_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "photo";
}

/** "01-Swimming-Pool.jpg": the position prefix keeps names unique and sorted. */
export function orderedFileName(position: number, total: number, label: string | null | undefined): string {
  const width = Math.max(2, String(total).length);
  return `${String(position).padStart(width, "0")}-${fileSlug(label)}.jpg`;
}

export interface ExportPhoto {
  src: string;
  label: string | null;
  /** 1-based position in the gallery before re-ordering. */
  wasNumber: number;
}

export interface ExportResult {
  zip: Blob;
  /**
   * Photos that couldn't be fetched or compressed, as "#3 Bedroom", in order.
   * They are left out of the zip and listed as MISSING in order.csv.
   */
  failed: string[];
}

/**
 * Compress every photo to the size limit and pack them, in the given order, into
 * a zip with an order.csv for the listing team. Runs a few photos at a time.
 */
export async function zipPhotosInOrder(
  photos: ExportPhoto[],
  onProgress?: (done: number, total: number) => void,
  maxBytes = MAX_PHOTO_BYTES
): Promise<ExportResult> {
  const total = photos.length;
  const results: ({ name: string; bytes: Uint8Array; kb: number } | null)[] = new Array(total).fill(null);
  let next = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const p = photos[i];
      try {
        const sized = await photoUnderLimit(p.src, maxBytes);
        results[i] = {
          name: orderedFileName(i + 1, total, p.label),
          bytes: new Uint8Array(await sized.blob.arrayBuffer()),
          kb: Math.round(sized.blob.size / 1000),
        };
      } catch {
        // Left null: reported below, in position order.
      }
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, total) }, () => worker()));

  const csvCell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [["Position", "File", "Was photo #", "Label", "Size (KB)"].join(",")];
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const failed: string[] = [];
  results.forEach((r, i) => {
    const p = photos[i];
    if (!r) {
      // Keep the row so the listing team sees the gap in the numbering.
      failed.push(`#${i + 1} ${p.label?.trim() || "photo"}`);
      rows.push([i + 1, "MISSING - could not be downloaded", p.wasNumber, p.label ?? "", ""].map(csvCell).join(","));
      return;
    }
    // JPEGs are already compressed, so store them as-is (level 0) for speed.
    files[r.name] = [r.bytes, { level: 0 }];
    rows.push([i + 1, r.name, p.wasNumber, p.label ?? "", r.kb].map(csvCell).join(","));
  });
  files["order.csv"] = [new TextEncoder().encode(rows.join("\n") + "\n"), { level: 0 }];

  // zipSync returns a fresh, non-shared buffer; the cast just tells TypeScript so.
  const zipped = zipSync(files) as Uint8Array<ArrayBuffer>;
  return { zip: new Blob([zipped], { type: "application/zip" }), failed };
}
