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
 *   ?q=<text>       → slim matches by name / city / state (tiny payload)
 *   ?id=<id>        → the one selected property WITH photos, for analysis
 *   ?ids=<a,b,c>    → up to 60 properties WITH photos, for the villa-card carousels
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
  videoCount: number;
  thumbnail?: string;
  /** Upstream page this property was found on — for on-demand photo fetch. */
  page: number;
}

/** Most properties a single ?ids= request may hydrate. */
const MAX_IDS = 60;

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
        videoCount: p.videoCount,
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
  // v2: photosCount now excludes videos, and entries carry videoCount.
  ["vista-slim-index-v2"],
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
  const ids = sp.get("ids");

  let slim: SlimEntry[];
  try {
    slim = await getSlimIndex(apiKey, secretKey);
  } catch {
    return NextResponse.json({ error: "Could not reach the Vista API." }, { status: 502 });
  }

  // Batch fetch (with photos) for a page of search results, so every villa card
  // can show its full gallery. Each upstream page is fetched once, even when it
  // holds several of the requested properties, and stays fetch-cached.
  if (ids) {
    const wanted = Array.from(
      new Set(ids.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))
    ).slice(0, MAX_IDS);
    const entries = wanted
      .map((n) => slim.find((e) => e.id === n))
      .filter((e): e is SlimEntry => e !== undefined);
    const pages = Array.from(new Set(entries.map((e) => e.page)));
    const pageLists = new Map<number, any[]>();
    await Promise.all(
      pages.map((p) =>
        fetchPageData(p, apiKey, secretKey)
          .then((d) => pageLists.set(p, Array.isArray(d?.response?.data) ? d.response.data : []))
          .catch(() => pageLists.set(p, []))
      )
    );
    const properties = entries.flatMap((e) => {
      const raw = (pageLists.get(e.page) ?? []).find((r) => r?.id === e.id);
      // Cards don't need amenities; dropping them keeps the payload small.
      return raw ? [{ ...mapRawProperty(raw), amenities: [] }] : [];
    });
    return NextResponse.json({ properties });
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

  // A purely-numeric query is treated as a property-ID lookup (exact, then
  // prefix); otherwise match on name / city / state.
  const isNumeric = q.length > 0 && /^\d+$/.test(q);
  const matches = q
    ? isNumeric
      ? slim
          .filter((p) => String(p.id) === q || String(p.id).startsWith(q))
          .sort((a, b) => (String(a.id) === q ? -1 : 0) - (String(b.id) === q ? -1 : 0))
      : slim.filter(
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
