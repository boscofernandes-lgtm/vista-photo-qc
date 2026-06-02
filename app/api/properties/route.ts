import { NextRequest, NextResponse } from "next/server";
import { VISTA_BASE, mapRawProperty, VistaPagination } from "@/lib/vistaApi";

export const runtime = "nodejs";

/**
 * Paginated StayVista property catalog. Holds the production API credentials
 * server-side (Vercel env vars) so the keys never reach the browser — the
 * frontend only ever sees the trimmed property list this route returns.
 */
export async function GET(req: NextRequest) {
  const apiKey = process.env.VISTA_API_KEY;
  const secretKey = process.env.VISTA_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return NextResponse.json(
      { error: "Vista API is not configured. Set VISTA_API_KEY and VISTA_SECRET_KEY in the environment." },
      { status: 501 }
    );
  }

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10) || 1);

  let data: any;
  try {
    const r = await fetch(`${VISTA_BASE}/property-list?page=${page}`, {
      headers: { Accept: "application/json", apiKey, secretKey },
      cache: "no-store",
    });
    if (!r.ok) {
      return NextResponse.json({ error: `Vista API responded ${r.status}` }, { status: 502 });
    }
    data = await r.json();
  } catch {
    return NextResponse.json({ error: "Could not reach the Vista API." }, { status: 502 });
  }

  const rawList: any[] = Array.isArray(data?.response?.data) ? data.response.data : [];
  const pg = data?.response?.pagination ?? {};
  const properties = rawList.map(mapRawProperty).filter((p) => p.id != null);

  const pagination: VistaPagination = {
    total: typeof pg.total === "number" ? pg.total : properties.length,
    per_page: typeof pg.per_page === "number" ? pg.per_page : properties.length,
    current_page: typeof pg.current_page === "number" ? pg.current_page : page,
    total_pages: typeof pg.total_pages === "number" ? pg.total_pages : page,
  };

  return NextResponse.json({ properties, pagination });
}
