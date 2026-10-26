import { ImageInput, PropertyMeta } from "./types";

/**
 * Adapter for the StayVista (vistarooms) production API.
 *
 *   Base:    https://api.vistarooms.com/api/v2
 *   Auth:    apiKey + secretKey HEADERS (never query params)
 *   List:    GET /property-list?page=<n>
 *            -> { response: { data: [property], pagination: { total_pages, ... } } }
 *
 * Each list entry is the FULL property object (photos, amenities, etc.), so a
 * selected property needs no second fetch. The only place Vista field names
 * live is `mapRawProperty` below — if the upstream shape changes, fix it here.
 */

export const VISTA_BASE = "https://api.vistarooms.com/api/v2";
export const VISTA_IMG_HOST = "img.vistarooms.com";

export interface VistaPhoto {
  /** Original CDN url (img.vistarooms.com). Proxied at render time. */
  source: string;
  /** Room/space label, e.g. "Swimming Pool", "Bedroom 1" — may be null. */
  tag: string | null;
  order: number;
  /** Galleries mix in short videos (.mp4); those can't be photo-checked. */
  kind: "image" | "video";
}

export interface VistaAmenity {
  name: string;
  value: string;
}

/** Trimmed property shape returned by our /api/properties route. */
export interface VistaProperty {
  id: number;
  name: string;
  slug: string;
  city?: string;
  state?: string;
  propertyType?: string;
  rooms?: number;
  maxOccupancy?: number;
  /** Still photos only — videos are counted separately. */
  photosCount: number;
  videoCount: number;
  /** Proxied first photo, for list thumbnails. */
  thumbnail?: string;
  /** The full gallery in listing order, photos and videos. */
  photos: VistaPhoto[];
  amenities: VistaAmenity[];
}

export interface VistaPagination {
  total: number;
  per_page: number;
  current_page: number;
  total_pages: number;
}

export interface VistaListResponse {
  properties: VistaProperty[];
  pagination: VistaPagination;
}

/** Wrap a CDN image url so the browser can read its pixels same-origin. */
export function proxied(url: string): string {
  return `/api/proxy?u=${encodeURIComponent(url)}`;
}

/** Gallery entries that are videos, not photos (they fail to decode as images). */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(url);
}

/** Map one raw Vista API property object into our trimmed shape (server-side). */
export function mapRawProperty(raw: any): VistaProperty {
  const photos: VistaPhoto[] = Array.isArray(raw?.photos)
    ? raw.photos
        .filter((ph: any) => typeof ph?.source === "string" && ph.source.includes(VISTA_IMG_HOST))
        .map((ph: any) => ({
          source: ph.source as string,
          tag: ph?.tag ?? null,
          order: typeof ph?.order === "number" ? ph.order : 0,
          kind: isVideoUrl(ph.source) ? "video" : "image",
        }))
        .sort((a: VistaPhoto, b: VistaPhoto) => a.order - b.order)
    : [];
  const stills = photos.filter((ph) => ph.kind === "image");

  const amenities: VistaAmenity[] = Array.isArray(raw?.amenities)
    ? raw.amenities
        .filter((a: any) => typeof a?.name === "string")
        .map((a: any) => ({ name: a.name as string, value: String(a?.value ?? "") }))
    : [];

  return {
    id: raw?.id,
    name: raw?.vista_name ?? "Unnamed property",
    slug: raw?.slug ?? "",
    city: raw?.city ?? undefined,
    state: raw?.state ?? undefined,
    propertyType: raw?.property_type ?? undefined,
    rooms: typeof raw?.rooms === "number" ? raw.rooms : undefined,
    maxOccupancy: typeof raw?.max_occupancy === "number" ? raw.max_occupancy : undefined,
    photosCount: stills.length,
    videoCount: photos.length - stills.length,
    thumbnail: stills[0] ? proxied(stills[0].source) : undefined,
    photos,
    amenities,
  };
}

/** Photos at the front of the gallery that are always checked: guests see these first. */
const ALWAYS_CHECK_FIRST = 8;

/**
 * Pick at most `max` items, keeping gallery order: always the first few (the
 * cover and what guests see first), then the remaining slots spread evenly over
 * the rest so the sample still represents the whole gallery.
 */
export function sampleFrontLoaded<T>(arr: T[], max: number): T[] {
  if (max <= 0) return [];
  if (arr.length <= max) return arr;
  const head = arr.slice(0, Math.min(ALWAYS_CHECK_FIRST, max));
  const rest = arr.slice(head.length);
  const slots = max - head.length;
  const step = rest.length / slots;
  return [...head, ...Array.from({ length: slots }, (_, i) => rest[Math.floor(i * step)])];
}

/**
 * Convert a selected property's photos into analyzer inputs. Videos are left
 * out (they can't be photo-checked). When `max` is set and the gallery is
 * larger, the first few photos (the cover and what guests see first) are always
 * included and the remaining slots are spread EVENLY over the rest, so coverage
 * stays representative while keeping analysis fast. Each input keeps its
 * position in the full gallery so reports can name the real photo number.
 */
export function toImageInputs(p: VistaProperty, max?: number): ImageInput[] {
  // Older cached payloads may lack `kind`; fall back to the URL check.
  let stills = p.photos
    .map((ph, listingIndex) => ({ ph, listingIndex }))
    .filter(({ ph }) => (ph.kind ?? (isVideoUrl(ph.source) ? "video" : "image")) === "image");
  if (max) stills = sampleFrontLoaded(stills, max);
  return stills.map(({ ph, listingIndex }) => ({
    id: `vista-${p.id}-${listingIndex}`,
    src: proxied(ph.source),
    originalUrl: ph.source,
    label: ph.tag ?? undefined,
    source: "url" as const,
    listingIndex,
  }));
}

/** Build the report meta block for a selected property. */
export function toMeta(p: VistaProperty): PropertyMeta {
  return {
    name: p.name,
    city: p.city,
    state: p.state,
    photosCount: p.photosCount,
    sourceUrl: p.slug ? `https://www.stayvista.com/villa/${p.slug}` : undefined,
  };
}
