import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Only proxy StayVista's image CDN — prevents the route being used as an open SSRF relay. */
const ALLOWED_IMG_HOSTS = new Set(["img.vistarooms.com"]);

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return new NextResponse("Missing ?u", { status: 400 });

  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return new NextResponse("Invalid URL", { status: 400 });
  }
  if (url.protocol !== "https:" || !ALLOWED_IMG_HOSTS.has(url.hostname)) {
    return new NextResponse("Host not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VistaPhotoQC/1.0)" },
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Upstream error", { status: 502 });
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse("Fetch failed", { status: 502 });
  }
}
