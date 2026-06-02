import { NextRequest, NextResponse } from "next/server";
import { VISTA_BASE, mapRawProperty, VistaProperty } from "@/lib/vistaApi";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * StayVista catalog search.
 *
 * The upstream /property-list endpoint has no search and a fixed 15/page (118
 * pages). To make search instant we walk the catalog ONCE, keep a slim in-memory
 * index (cached on the warm serverless instance), and serve:
 *   • ?q=<text>  → slim matches by name / city / state (no photos — tiny payload)
 *   • ?id=<id>   → the one selected property WITH its photos, for analysis
 * No query and no id returns an empty result set (search-first UX).
 */

interface CatalogIndex {
  at: number;
  byId: Map<number, VistaProperty>;
  all: VistaProperty[];
}

let INDEX: CatalogIndex | null = null;
let BUILDING: Promise<CatalogIndex> | null = null;
const TTL_MS = 30 * 60 * 1000; // 30 min — catalog changes rarely
const CONCURRENCY = 12;

async function fetchPage(
  page: number,
  apiKey: string,
  secretKey: string
): Promise<{ props: VistaProperty[]; totalPages: number }> {
  const r = await fetch(`${VISTA_BASE}/property-list?page=${page}`, {
    headers: { Accept: "application/json", apiKey, secretKey },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Vista API ${r.status}`);
  const d = await r.json();
  const list: any[] = Array.isArray(d?.response?.data) ? d.response.data : [];
  const totalPages = d?.response?.pagination?.total_pages ?? 1;
  return { props: list.map(mapRawProperty).filter((p) => p.id != null), totalPages };
}

async function buildIndex(apiKey: string, secretKey: string): Promise<CatalogIndex> {
  const first = await fetchPage(1, apiKey, secretKey);
  const all: VistaProperty[] = [...first.props];

  const pages: number[] = [];
  for (let p = 2; p <= first.totalPages; p++) pages.push(p);

  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const res = await Promise.all(
      batch.map((p) =>
        fetchPage(p, apiKey, secretKey).catch(() => ({ props: [] as VistaProperty[], totalPages: 0 }))
      )
    );
    res.forEach((r) => all.push(...r.props));
  }

  const byId = new Map(all.map((p) => [p.id, p]));
  return { at: Date.now(), byId, all };
}

async function getIndex(apiKey: string, secretKey: string): Promise<CatalogIndex> {
  if (INDEX && Date.now() - INDEX.at < TTL_MS) return INDEX;
  if (BUILDING) return BUILDING;
  BUILDING = buildIndex(apiKey, secretKey)
    .then((idx) => {
      INDEX = idx;
      BUILDING = null;
      return idx;
    })
    .catch((e) => {
      BUILDING = null;
      throw e;
    });
  return BUILDING;
}

/** Strip photos/amenities for the search list — keep the payload tiny. */
function slim(p: VistaProperty) {
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    state: p.state,
    propertyType: p.propertyType,
    rooms: p.rooms,
    maxOccupancy: p.maxOccupancy,
    photosCount: p.photosCount,
    thumbnail: p.thumbnail,
  };
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

  let idx: CatalogIndex;
  try {
    idx = await getIndex(apiKey, secretKey);
  } catch {
    return NextResponse.json({ error: "Could not reach the Vista API." }, { status: 502 });
  }

  // Single-property fetch (with photos) for the selected listing.
  if (id) {
    const p = idx.byId.get(Number(id));
    if (!p) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    return NextResponse.json({ property: p });
  }

  // Search.
  const q = (sp.get("q") || "").trim().toLowerCase();
  const limit = Math.min(60, Math.max(1, parseInt(sp.get("limit") || "40", 10) || 40));

  const matches = q
    ? idx.all.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.city ?? "").toLowerCase().includes(q) ||
          (p.state ?? "").toLowerCase().includes(q)
      )
    : [];

  return NextResponse.json({
    results: matches.slice(0, limit).map(slim),
    total: matches.length,
    indexed: idx.all.length,
  });
}
