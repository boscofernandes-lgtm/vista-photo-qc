import { NextRequest, NextResponse } from "next/server";
 
export const runtime = "nodejs";
export const maxDuration = 60;
 
/**
 * OpenAI-powered rubric scoring. Holds the key server-side (never sent to the
 * browser) as the OPENAI_API_KEY environment variable on Vercel.
 *
 * Request body: { brand, mode, brandVibe, threshold, images: [{label, category, dataUrl}] }
 * Response: { mode, categories: { <cat>: { score 1-5, reason } }, summary }
 */
 
const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
 
/**
 * Model fallback chain. OPENAI_MODEL (if set) is tried first; the rest are
 * appended as fallbacks (deduped). Unlike Gemini's per-model free quotas, an
 * OpenAI key shares one org-wide quota — so the chain mainly guards against a
 * model ID being unavailable on your account, not against quota exhaustion.
 */
const MODELS: string[] = Array.from(
  new Set(
    [process.env.OPENAI_MODEL, "gpt-5.6-luna", "gpt-5.6-terra", "gpt-4o-mini"].filter(
      (m): m is string => !!m
    )
  )
);
 
/** "auto" | "low" | "high" — photos are already downscaled to 512px client-side. */
const IMAGE_DETAIL = process.env.OPENAI_IMAGE_DETAIL || "auto";
 
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
    `Keep every "reason" to at most 18 words and the "summary" to one sentence of at most 30 words.`,
  ].join("\n");
}
 
/** Strict JSON schema for the response, built per mode so keys are fixed. */
function buildSchema(mode: Mode) {
  const cats = mode === "full" ? FULL_CATS : HYBRID_CATS;
  const catProps: Record<string, object> = {};
  for (const c of cats) {
    catProps[c] = {
      type: "object",
      additionalProperties: false,
      required: ["score", "reason"],
      properties: {
        score: { type: "integer", minimum: 1, maximum: 5 },
        reason: { type: "string" },
      },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["categories", "summary"],
    properties: {
      categories: {
        type: "object",
        additionalProperties: false,
        required: [...cats],
        properties: catProps,
      },
      summary: { type: "string" },
    },
  };
}
 
function isImageDataUrl(dataUrl: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,.+$/.test(dataUrl);
}
 
/** Pull the assistant text out of a raw Responses API payload. */
function extractText(res: {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
}): { text?: string; refusal?: string } {
  if (typeof res.output_text === "string" && res.output_text.trim()) {
    return { text: res.output_text };
  }
  let text = "";
  let refusal = "";
  for (const item of res.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) text += part.text;
      if (part.type === "refusal" && part.refusal) refusal += part.refusal;
    }
  }
  return { text: text || undefined, refusal: refusal || undefined };
}
 
export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "AI scoring is not configured. Set OPENAI_API_KEY in the environment." },
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
  const MAX = Number(process.env.OPENAI_MAX_IMAGES) || 8;
  let sample = images;
  if (images.length > MAX) {
    const step = images.length / MAX;
    sample = Array.from({ length: MAX }, (_, i) => images[Math.floor(i * step)]);
  }
 
  const content: object[] = [
    { type: "input_text", text: buildPrompt(body.brandName || "StayVista Villas", body.brandVibe || "", mode) },
  ];
  for (const im of sample) {
    if (!isImageDataUrl(im.dataUrl)) continue;
    if (im.label || im.category) {
      content.push({
        type: "input_text",
        text: `Photo — label: ${im.label ?? "?"}, detected type: ${im.category ?? "?"}`,
      });
    }
    content.push({ type: "input_image", image_url: im.dataUrl, detail: IMAGE_DETAIL });
  }
 
  if (content.length === 1) {
    return NextResponse.json({ error: "No readable images in request" }, { status: 400 });
  }
 
  const basePayload = {
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "stayvista_photo_rubric",
        strict: true,
        schema: buildSchema(mode),
      },
    },
    max_output_tokens: 2000,
  };
 
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
 
  // Try each model in the fallback chain. Within a model, retry transient
  // rate-limit (429) / overload (5xx) with exponential backoff, honoring
  // Retry-After. A hard quota error moves on to the next model.
  let aiRes: Response | null = null;
  let lastBody = "";
  let lastStatus = 502;
  const MAX_TRIES = 3;
 
  outer: for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      try {
        aiRes = await fetch(OPENAI_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model, ...basePayload }),
        });
      } catch (e) {
        return NextResponse.json({ error: `Could not reach OpenAI: ${(e as Error).message}` }, { status: 502 });
      }
 
      if (aiRes.ok) break outer;
 
      lastBody = await aiRes.text().catch(() => "");
      lastStatus = aiRes.status;
 
      // Hard billing/quota failure — retrying or switching model won't help.
      if (lastBody.includes("insufficient_quota")) break outer;
 
      // 429 rate limit or 5xx overload → back off and retry the same model.
      if ((aiRes.status === 429 || aiRes.status >= 500) && attempt < MAX_TRIES - 1) {
        const retryAfter = Number(aiRes.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * 2 ** attempt;
        await sleep(Math.min(waitMs, 6000));
        continue;
      }
 
      // 400/404 usually means this model ID isn't available on the account → try next.
      if (aiRes.status === 400 || aiRes.status === 404) break;
 
      break outer;
    }
  }
 
  if (!aiRes || !aiRes.ok) {
    if (lastBody.includes("insufficient_quota")) {
      return NextResponse.json(
        {
          error:
            "OpenAI reports no remaining credit on this key. Add a payment method / top up credits at platform.openai.com/settings/organization/billing, then retry.",
          detail: lastBody.slice(0, 300),
        },
        { status: 429 }
      );
    }
    if (lastStatus === 401) {
      return NextResponse.json(
        { error: "OpenAI rejected the API key (401). Check OPENAI_API_KEY in Vercel and redeploy.", detail: lastBody.slice(0, 300) },
        { status: 401 }
      );
    }
    if (lastStatus === 429) {
      return NextResponse.json(
        {
          error:
            "OpenAI rate limit hit. New keys start on a low tier — wait a moment and retry, or reduce the number of photos scored.",
          detail: lastBody.slice(0, 300),
        },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: `OpenAI error ${lastStatus}`, detail: lastBody.slice(0, 400) },
      { status: 502 }
    );
  }
 
  const raw = await aiRes.json();
  const { text, refusal } = extractText(raw);
 
  if (refusal && !text) {
    return NextResponse.json({ error: `Model refused: ${refusal.slice(0, 200)}` }, { status: 502 });
  }
  if (!text) {
    const incomplete = raw?.incomplete_details?.reason;
    return NextResponse.json(
      { error: incomplete ? `Empty response from OpenAI (${incomplete})` : "Empty response from OpenAI" },
      { status: 502 }
    );
  }
 
  let parsed: { categories?: Record<string, { score: number; reason: string }>; summary?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    // Belt-and-braces: strict schema should prevent this, but extract the first {...} block.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "OpenAI did not return JSON", raw: text.slice(0, 400) }, { status: 502 });
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return NextResponse.json({ error: "OpenAI JSON parse failed", raw: text.slice(0, 400) }, { status: 502 });
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
