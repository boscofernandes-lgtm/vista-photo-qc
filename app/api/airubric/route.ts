import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Optional Gemini-powered rubric scoring. Holds the key server-side (never sent
 * to the browser) as the GEMINI_API_KEY environment variable on Vercel.
 *
 * Request body: { brand, mode, brandVibe, threshold, images: [{label, category, dataUrl}] }
 * Response: { mode, categories: { <cat>: { score 1-5, reason } }, summary }
 */

/**
 * Model fallback chain. Each model has its OWN free-tier quota pool, so if the
 * primary is quota-exhausted (429) we transparently try the next one — a single
 * blocked model can't kill AI scoring during a demo. GEMINI_MODEL (if set) is
 * tried first; the rest are appended as fallbacks (deduped).
 */
const MODELS: string[] = Array.from(
  new Set(
    [process.env.GEMINI_MODEL, "gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"].filter(
      (m): m is string => !!m
    )
  )
);

type Mode = "hybrid" | "full";

interface ReqImage {
  label?: string;
  category?: string;
  dataUrl: string; // data:image/jpeg;base64,....
}

const HYBRID_CATS = ["cover", "setups", "lifestyle"] as const;
const FULL_CATS = ["cover", "setups", "lifestyle", "lighting", "angles", "edits"] as const;

const RUBRIC: Record<string, string> = {
  cover:
    "Cover & Facade — the hero shot. 5 = golden hour, dramatic sky, cinematic depth, clean forecourt, no vehicles. 1 = dark, blurry, bad angle, clutter blocking.",
  setups:
    "Set ups (Food & Interiors) — styling of dining/rooms. 5 = editorial: candles, linen, flowers, full table set, styled cushions/bedside. 1 = empty tables, bare rooms, no styling.",
  lifestyle:
    "Lifestyle (Service, Guest, Experiences) — humans/service in frame. 5 = multiple warm, natural, story-driven moments; clean caretaker in pressed uniform with service item. 1 = no lifestyle shots at all.",
  lighting:
    "Lighting — exposure quality. 5 = perfect exposure, warm mood, all lights on, HDR windows, no blown areas. 1 = severely over/under exposed, blown windows, pitch-dark rooms.",
  angles:
    "Angles & Frames — composition. 5 = corner shots at ~1.2m, 60%+ of room visible, no distortion, level horizon. 1 = wrong height/lens, severe distortion, room barely visible.",
  edits:
    "Edits — post-processing. 5 = professional HDR grade, warm tone, lifted shadows, natural colour, crisp & clean, straight verticals. 1 = raw/unprocessed or heavily filtered, wrong white balance.",
};

function buildPrompt(brandName: string, brandVibe: string, mode: Mode): string {
  const cats = (mode === "full" ? FULL_CATS : HYBRID_CATS).map((c) => `- ${c}: ${RUBRIC[c]}`).join("\n");
  return [
    `You are a StayVista photography QC reviewer scoring a property's photo set for the sub-brand "${brandName}".`,
    `Brand editing direction: ${brandVibe}`,
    ``,
    `Score ONLY these categories, each as a whole integer 1-5 (1 = very poor, 5 = excellent), judging the WHOLE set together:`,
    cats,
    ``,
    `Be strict and honest — most real listings sit at 2-4. Reserve 5 for genuinely editorial work and 1 for missing/broken categories.`,
    `Base scores only on what is visibly in the photos. For "lifestyle", if there are no people/service shots at all, score 1.`,
    ``,
    `Respond with STRICT JSON only, no markdown, in exactly this shape:`,
    `{"categories":{${(mode === "full" ? FULL_CATS : HYBRID_CATS)
      .map((c) => `"${c}":{"score":<1-5>,"reason":"<max 18 words>"}`)
      .join(",")}},"summary":"<one sentence, max 30 words>"}`,
  ].join("\n");
}

function dataUrlToInline(dataUrl: string): { mime_type: string; data: string } | null {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime_type: m[1], data: m[2] };
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "AI scoring is not configured. Set GEMINI_API_KEY in the environment." },
      { status: 501 }
    );
  }

  let body: { brand?: string; brandName?: string; brandVibe?: string; mode?: Mode; images?: ReqImage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode: Mode = body.mode === "full" ? "full" : "hybrid";
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) {
    return NextResponse.json({ error: "No images supplied" }, { status: 400 });
  }

  // Cap images to keep token cost + latency bounded; sample evenly across the set.
  // Fewer images = fewer tokens = less likely to trip the free-tier rate limit.
  const MAX = 8;
  let sample = images;
  if (images.length > MAX) {
    const step = images.length / MAX;
    sample = Array.from({ length: MAX }, (_, i) => images[Math.floor(i * step)]);
  }

  const parts: object[] = [{ text: buildPrompt(body.brandName || "StayVista Villas", body.brandVibe || "", mode) }];
  for (const im of sample) {
    const inline = dataUrlToInline(im.dataUrl);
    if (!inline) continue;
    if (im.label || im.category) parts.push({ text: `Photo — label: ${im.label ?? "?"}, detected type: ${im.category ?? "?"}` });
    parts.push({ inline_data: inline });
  }

  const payload = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Try each model in the fallback chain. Within a model, retry transient
  // rate-limit (429) / overload (503) with exponential backoff, honoring
  // Retry-After. A persistent 429 (quota exhausted) moves on to the next model.
  let gemRes: Response | null = null;
  let lastBody = "";
  let lastStatus = 502;
  const MAX_TRIES = 2;

  outer: for (const model of MODELS) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      try {
        gemRes = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
      } catch (e) {
        return NextResponse.json({ error: `Could not reach Gemini: ${(e as Error).message}` }, { status: 502 });
      }

      if (gemRes.ok) break outer;

      lastBody = await gemRes.text().catch(() => "");
      lastStatus = gemRes.status;

      // 429 = this model's quota is spent → stop retrying it, try next model.
      if (gemRes.status === 429) break;
      // 503 = transient overload → back off and retry the same model.
      if (gemRes.status === 503 && attempt < MAX_TRIES - 1) {
        const retryAfter = Number(gemRes.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * 2 ** attempt;
        await sleep(Math.min(waitMs, 6000));
        continue;
      }
      // Any other non-OK status: don't burn the rest of the chain.
      break outer;
    }
  }

  if (!gemRes || !gemRes.ok) {
    if (lastStatus === 429) {
      return NextResponse.json(
        {
          error:
            "Gemini quota exhausted on all available models (free tier allows only a limited number of requests per day). The daily quota resets at midnight Pacific — or enable billing on your key's Google Cloud project for higher limits. Usage: https://ai.dev/rate-limit",
          detail: lastBody.slice(0, 300),
        },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: `Gemini error ${lastStatus}`, detail: lastBody.slice(0, 400) },
      { status: 502 }
    );
  }

  const gem = await gemRes.json();
  const text: string | undefined = gem?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join("") ?? undefined;
  if (!text) {
    return NextResponse.json({ error: "Empty response from Gemini" }, { status: 502 });
  }

  let parsed: { categories?: Record<string, { score: number; reason: string }>; summary?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    // Some models wrap JSON in stray text; extract the first {...} block.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Gemini did not return JSON", raw: text.slice(0, 400) }, { status: 502 });
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return NextResponse.json({ error: "Gemini JSON parse failed", raw: text.slice(0, 400) }, { status: 502 });
    }
  }

  // Sanitise: keep only allowed categories, clamp scores to whole 1-5.
  const allowed = mode === "full" ? FULL_CATS : HYBRID_CATS;
  const categories: Record<string, { score: number; reason: string }> = {};
  for (const c of allowed) {
    const v = parsed.categories?.[c];
    if (v && typeof v.score === "number") {
      categories[c] = {
        score: Math.max(1, Math.min(5, Math.round(v.score))),
        reason: String(v.reason ?? "").slice(0, 160),
      };
    }
  }

  return NextResponse.json({ mode, categories, summary: String(parsed.summary ?? "").slice(0, 240) });
}
