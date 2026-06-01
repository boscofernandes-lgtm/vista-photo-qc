import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_PAGE_HOST = "www.stayvista.com";
const IMG_HOST = "img.vistarooms.com";

function proxied(url: string): string {
  return `/api/proxy?u=${encodeURIComponent(url)}`;
}

interface SpaceItem {
  image?: string;
  title?: string;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing ?url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== ALLOWED_PAGE_HOST) {
    return NextResponse.json(
      { error: `Only https://${ALLOWED_PAGE_HOST}/villa/... URLs are supported` },
      { status: 400 }
    );
  }

  let html: string;
  try {
    const res = await fetch(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VistaPhotoQC/1.0)" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
    }
    html = await res.text();
  } catch {
    return NextResponse.json({ error: "Failed to fetch page" }, { status: 502 });
  }

  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) {
    return NextResponse.json({ error: "Could not parse property data" }, { status: 422 });
  }

  let data: any;
  try {
    data = JSON.parse(m[1]).props.pageProps.propertyDetailsObj.data;
  } catch {
    return NextResponse.json({ error: "Unexpected page structure" }, { status: 422 });
  }

  const detail = data?.property_detail ?? {};
  const seen = new Set<string>();
  const images: { id: string; src: string; originalUrl: string; label?: string }[] = [];

  const add = (url: unknown, label?: string) => {
    if (typeof url !== "string" || !url.includes(IMG_HOST)) return;
    if (seen.has(url)) return;
    seen.add(url);
    images.push({
      id: `img-${images.length}`,
      src: proxied(url),
      originalUrl: url,
      label,
    });
  };

  // Hero / cover shots
  for (const g of data?.mini_gallery ?? []) add(g?.src, "Gallery");
  // Room-labelled space shots
  for (const s of (data?.space ?? []) as SpaceItem[]) add(s?.image, s?.title);

  const meta = {
    name: detail.vista_name ?? "Unknown property",
    city: detail.city ?? undefined,
    state: detail.state ?? undefined,
    photosCount: detail.photos_count ?? undefined,
    sourceUrl: parsed.toString(),
  };

  return NextResponse.json({ meta, images });
}
