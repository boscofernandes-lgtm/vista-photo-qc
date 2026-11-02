import { ImageInput } from "./types";
import { VistaProperty, isVideoUrl, proxied, sampleFrontLoaded } from "./vistaApi";

/**
 * One entry in a villa's gallery, in listing order. Every tab (Browse, URL,
 * Upload, Bulk) describes photos this way, so the card carousel, the photo
 * viewer, the gallery organiser and the download all share one shape.
 */
export interface GalleryPhoto {
  /** Unique within the villa. The analyser uses it as the photo's id, so verdicts map back by key. */
  key: string;
  kind: "image" | "video";
  /** Same-origin URL for an image (proxied CDN photo or a local blob); the original URL for a video. */
  src: string;
  /** The remote original, when there is one. */
  originalUrl?: string;
  /** Room label for StayVista photos; the file name for uploads. */
  label: string | null;
}

/** A gallery entry as returned by /api/scrape. */
export interface ScrapedPhoto {
  src: string;
  originalUrl: string;
  label?: string;
  kind: "image" | "video";
}

export function galleryFromProperty(p: VistaProperty): GalleryPhoto[] {
  return p.photos.map((ph, i) => {
    const kind = ph.kind ?? (isVideoUrl(ph.source) ? "video" : "image");
    return {
      key: `${p.id}-${i}`,
      kind,
      src: kind === "video" ? ph.source : proxied(ph.source),
      originalUrl: ph.source,
      label: ph.tag,
    };
  });
}

export function galleryFromScrape(photos: ScrapedPhoto[], prefix: string): GalleryPhoto[] {
  return photos.map((ph, i) => ({
    key: `${prefix}-${i}`,
    kind: ph.kind,
    src: ph.kind === "video" ? ph.originalUrl : ph.src,
    originalUrl: ph.originalUrl,
    label: ph.label ?? null,
  }));
}

/** Uploaded files become a gallery of local blob URLs (kept for the session). */
export function galleryFromFiles(files: File[], prefix: string): GalleryPhoto[] {
  return files.map((f, i) => ({
    key: `${prefix}-${i}`,
    kind: "image" as const,
    src: URL.createObjectURL(f),
    label: f.name,
  }));
}

/**
 * Analyser inputs for a gallery: still photos only, each keeping its gallery
 * position (so reports name the real photo number) and its gallery key as id.
 * With `max`, the first photos are always included and the rest are spread
 * evenly (the same sample in every tab).
 */
export function inputsFromGallery(gallery: GalleryPhoto[], source: "url" | "upload", max?: number): ImageInput[] {
  let stills = gallery
    .map((g, listingIndex) => ({ g, listingIndex }))
    .filter(({ g }) => g.kind === "image");
  if (max) stills = sampleFrontLoaded(stills, max);
  return stills.map(({ g, listingIndex }) => ({
    id: g.key,
    src: g.src,
    originalUrl: g.originalUrl,
    label: g.label ?? undefined,
    source,
    listingIndex,
  }));
}

/** The still photos of a gallery, arranged by `order` (gallery keys); anything missing keeps gallery order at the end. */
export function arrangeStills(gallery: GalleryPhoto[], order: string[] | undefined): GalleryPhoto[] {
  const stills = gallery.filter((g) => g.kind === "image");
  if (!order || order.length === 0) return stills;
  const byKey = new Map(stills.map((g) => [g.key, g]));
  const placed = order.map((k) => byKey.get(k)).filter((g): g is GalleryPhoto => g !== undefined);
  const seen = new Set(placed.map((g) => g.key));
  return [...placed, ...stills.filter((g) => !seen.has(g.key))];
}
