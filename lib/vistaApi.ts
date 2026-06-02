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
  photosCount: number;
  /** Proxied first photo, for list thumbnails. */
  thumbnail?: string;
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

/** Map one raw Vista API property object into our trimmed shape (server-side). */
export function mapRawProperty(raw: any): VistaProperty {
  const photos: VistaPhoto[] = Array.isArray(raw?.photos)
    ? raw.photos
        .filter((ph: any) => typeof ph?.source === "string" && ph.source.includes(VISTA_IMG_HOST))
        .map((ph: any) => ({
          source: ph.source as string,
          tag: ph?.tag ?? null,
          order: typeof ph?.order === "number" ? ph.order : 0,
        }))
        .sort((a: VistaPhoto, b: VistaPhoto) => a.order - b.order)
    : [];

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
    photosCount: photos.length,
    thumbnail: photos[0] ? proxied(photos[0].source) : undefined,
    photos,
    amenities,
  };
}

/**
 * Convert a selected property's photos into analyzer inputs. When `max` is set
 * and the gallery is larger, photos are sampled EVENLY across the set (not just
 * the first N) so coverage stays representative while keeping analysis fast.
 */
export function toImageInputs(p: VistaProperty, max?: number): ImageInput[] {
  let photos = p.photos;
  if (max && photos.length > max) {
    const step = photos.length / max;
    photos = Array.from({ length: max }, (_, i) => photos[Math.floor(i * step)]);
  }
  return photos.map((ph, i) => ({
    id: `vista-${p.id}-${i}`,
    src: proxied(ph.source),
    originalUrl: ph.source,
    label: ph.tag ?? undefined,
    source: "url" as const,
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
