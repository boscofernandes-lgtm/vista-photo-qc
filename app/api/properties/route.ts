import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { VISTA_BASE, mapRawProperty } from "@/lib/vistaApi";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * StayVista catalog search.
 *
 * The upstream /property-list endpoint has no search and a fixed 15/page (118
 * pages). To make search instant AND survive serverless cold starts / multiple
 * instances, we build a SLIM index (no photos, ~0.4 MB) once and store it in
 * Vercel's cross-instance Data Cache via unstable_cache. Each slim entry records
 * the page it lives on, so a single-property fetch pulls just that one page
 * (itself fetch-cached) and returns the full photo set on demand.
 *
 *   ?q=<text>  → slim matches by name / city / state (tiny payload)
 *   ?id=<id>   → the one selected property WITH photos, for analysis
 */

interface SlimEntry {
  id: number;
  name: string;
  city?: string;
  state?: string;
  propertyType?: string;
  rooms?: number;
  maxOccupancy?: number;
  photosCount: number;
  thumbnail?: string;
  /** Upstream page this property was found on — for on-demand photo fetch. */
  page: number;
}

const REVALIDATE = 1800; // 30 min
const CONCURRENCY = 20;

/** One upstream page; fetch-cached cross-instance so cold builds stay cheap. */
async function fetchPageData(page: number, apiKey: string, secretKey: string): Promise<any> {
  const r = await fetch(`${VISTA_BASE}/property-list?page=${page}`, {
    headers: { Accept: "application/json", apiKey, secretKey },
    next: { revalidate: REVALIDATE },
  });
  if (!r.ok) throw new Error(`Vista API ${r.status}`);
  return r.json();
}

/** Walk the whole catalog once and return slim entries (cached by unstable_cache). */
async function buildSlimIndex(apiKey: string, secretKey: string): Promise<SlimEntry[]> {
  const out: SlimEntry[] = [];
  const collect = (data: any, page: number) => {
    const list: any[] = Array.isArray(data?.response?.data) ? data.response.data : [];
    for (const raw of list) {
      const p = mapRawProperty(raw);
      if (p.id == null) continue;
      out.push({
        id: p.id,
        name: p.name,
        city: p.city,
        state: p.state,
        propertyType: p.propertyType,
        rooms: p.rooms,
        maxOccupancy: p.maxOccupancy,
        photosCount: p.photosCount,
        thumbnail: p.thumbnail,
        page,
      });
    }
  };

  const first = await fetchPageData(1, apiKey, secretKey);
  collect(first, 1);
  const totalPages = first?.response?.pagination?.total_pages ?? 1;

  const pages: number[] = [];
  for (let p = 2; p <= totalPages; p++) pages.push(p);

  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const res = await Promise.all(
      batch.map((p) =>
        fetchPageData(p, apiKey, secretKey)
          .then((d) => [d, p] as const)
          .catch(() => null)
      )
    );
    for (const r of res) if (r) collect(r[0], r[1]);
  }
  return out;
}

const getSlimIndex = unstable_cache(
  (apiKey: string, secretKey: string) => buildSlimIndex(apiKey, secretKey),
  ["vista-slim-index-v1"],
  { revalidate: REVALIDATE }
);

function publicEntry(e: SlimEntry) {
  const { page, ...rest } = e; // hide internal page hint
  return rest;
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.VISTA_API_KEY;
  const secretKey = process.env.VISTA_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return NextResponse.json(
      { error: "Vista API is not configured. Set VISTA_API_KEY and VISTA_SECRET_KEY in the environment." },
      { status: 501 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");

  let slim: SlimEntry[];
  try {
    slim = await getSlimIndex(apiKey, secretKey);
  } catch {
    return NextResponse.json({ error: "Could not reach the Vista API." }, { status: 502 });
  }

  // Single-property fetch (with photos) — pulls only the one cached page.
  if (id) {
    const nid = Number(id);
    const entry = slim.find((e) => e.id === nid);
    if (!entry) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    try {
      const data = await fetchPageData(entry.page, apiKey, secretKey);
      const list: any[] = Array.isArray(data?.response?.data) ? data.response.data : [];
      const raw = list.find((r) => r?.id === nid);
      if (!raw) return NextResponse.json({ error: "Property not found" }, { status: 404 });
      return NextResponse.json({ property: mapRawProperty(raw) });
    } catch {
      return NextResponse.json({ error: "Could not load property." }, { status: 502 });
    }
  }

  // Search.
  const q = (sp.get("q") || "").trim().toLowerCase();
  const limit = Math.min(60, Math.max(1, parseInt(sp.get("limit") || "40", 10) || 40));

  const matches = q
    ? slim.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.city ?? "").toLowerCase().includes(q) ||
          (p.state ?? "").toLowerCase().includes(q)
      )
    : [];

  return NextResponse.json({
    results: matches.slice(0, limit).map(publicEntry),
    total: matches.length,
    indexed: slim.length,
  });
}
