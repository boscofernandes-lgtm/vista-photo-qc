import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * OpenRouter-powered rubric scoring. Holds the key server-side (never sent to
 * the browser) as OPENROUTER_API_KEY (OPENAI_API_KEY is accepted as a fallback
 * name so an existing Vercel variable keeps working).
 *
 * OpenRouter exposes an OpenAI-compatible Chat Completions API — note this is
 * NOT api.openai.com, and model IDs are namespaced ("openai/gpt-5.6-luna").
 *
 * Request body: { brand, mode, brandVibe, threshold, images: [{label, category, dataUrl}] }
 * Response: { mode, categories: { <cat>: { score 1-5, reason } }, summary }
 */

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Model fallback chain. OPENROUTER_MODEL (if set) is tried first. Keys can be
 * restricted to specific models, so keep this list to models the key allows —
 * a disallowed model costs a wasted round trip.
 */
const MODELS: string[] = Array.from(
  new Set(
    [process.env.OPENROUTER_MODEL, process.env.OPENAI_MODEL, "openai/gpt-5.6-luna"].filter(
      (m): m is string => !!m
    )
  )
);

/** "auto" | "low" | "high" — photos are already downscaled to 512px client-side. */
const IMAGE_DETAIL = process.env.OPENROUTER_IMAGE_DETAIL || "auto";

/** Shared by reasoning + visible output, so this is not just the JSON's size. */
const MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS) || 8000;

/** Scoring is a judgement call, not a puzzle — "low" is plenty and much faster. */
const REASONING_EFFORT = process.env.OPENROUTER_REASONING_EFFORT || "low";

/** Optional attribution shown on OpenRouter's dashboard/leaderboards. */
const SITE_URL = process.env.OPENROUTER_SITE_URL || "https://vista-photo-qc.vercel.app";
const SITE_TITLE = "StayVista Photo QC";

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
        score: { type: "integer", minimum: 1, maximum: 5, description: "Whole number 1-5." },
        reason: { type: "string", description: "At most 18 words." },
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
      summary: { type: "string", description: "One sentence, at most 30 words." },
    },
  };
}

function isImageDataUrl(dataUrl: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,.+$/.test(dataUrl);
}

/** OpenRouter sometimes reports failures as HTTP 200 with an error body. */
function bodyError(json: { error?: { message?: string; code?: number | string } }): string | undefined {
  const m = json?.error?.message;
  return m ? String(m) : undefined;
}

export async function POST(req: NextRequest) {
  const key = (process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY)?.trim();
  if (!key) {
    return NextResponse.json(
      { error: "AI scoring is not configured. Set OPENROUTER_API_KEY in the environment." },
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
  const MAX = Number(process.env.OPENROUTER_MAX_IMAGES) || 8;
  let sample = images;
  if (images.length > MAX) {
    const step = images.length / MAX;
    sample = Array.from({ length: MAX }, (_, i) => images[Math.floor(i * step)]);
  }

  const content: object[] = [
    { type: "text", text: buildPrompt(body.brandName || "StayVista Villas", body.brandVibe || "", mode) },
  ];
  for (const im of sample) {
    if (!isImageDataUrl(im.dataUrl)) continue;
    if (im.label || im.category) {
      content.push({
        type: "text",
        text: `Photo — label: ${im.label ?? "?"}, detected type: ${im.category ?? "?"}`,
      });
    }
    content.push({ type: "image_url", image_url: { url: im.dataUrl, detail: IMAGE_DETAIL } });
  }

  if (content.length === 1) {
    return NextResponse.json({ error: "No readable images in request" }, { status: 400 });
  }

  const basePayload = {
    messages: [{ role: "user", content }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "stayvista_photo_rubric",
        strict: true,
        schema: buildSchema(mode),
      },
    },
    // Only route to providers that actually honour response_format. NOTE: this
    // filters on EVERY parameter present, so never add one the model rejects
    // (e.g. temperature — no GPT-5.x endpoint accepts it) or zero providers match
    // and the call fails before inference with a misleading "no endpoints" error.
    provider: { require_parameters: true },
    // Reasoning is on by default on GPT-5.x and its tokens are billed against
    // this budget, so leave generous headroom or the JSON gets truncated
    // (finish_reason "length") and content comes back empty.
    max_tokens: MAX_TOKENS,
    reasoning: { effort: REASONING_EFFORT },
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let aiRes: Response | null = null;
  let lastBody = "";
  let lastStatus = 502;
  const MAX_TRIES = 3;

  outer: for (const model of MODELS) {
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      try {
        aiRes = await fetch(OPENROUTER_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "HTTP-Referer": SITE_URL,
            "X-Title": SITE_TITLE,
          },
          body: JSON.stringify({ model, ...basePayload }),
        });
      } catch (e) {
        return NextResponse.json({ error: `Could not reach OpenRouter: ${(e as Error).message}` }, { status: 502 });
      }

      if (aiRes.ok) break outer;

      lastBody = await aiRes.text().catch(() => "");
      lastStatus = aiRes.status;

      // 429 rate limit or 5xx → back off and retry the same model.
      if ((aiRes.status === 429 || aiRes.status >= 500) && attempt < MAX_TRIES - 1) {
        const retryAfter = Number(aiRes.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1200 * 2 ** attempt;
        await sleep(Math.min(waitMs, 6000));
        continue;
      }

      // 400/403/404 — model not permitted for this key, or unavailable → try next.
      if (aiRes.status === 400 || aiRes.status === 403 || aiRes.status === 404) break;

      break outer;
    }
  }

  if (!aiRes || !aiRes.ok) {
    let msg = "";
    try {
      msg = JSON.parse(lastBody)?.error?.message ?? "";
    } catch {
      /* non-JSON body */
    }
    if (lastStatus === 401) {
      return NextResponse.json(
        {
          error: `OpenRouter rejected the API key (401)${msg ? `: ${msg}` : ""}. Keys start with sk-or-v1-.`,
          keyShape: `len=${key.length} prefix=${key.slice(0, 10)}`,
        },
        { status: 401 }
      );
    }
    if (lastStatus === 402) {
      return NextResponse.json(
        { error: `OpenRouter reports insufficient credits${msg ? `: ${msg}` : ""}. Top up at openrouter.ai/credits.` },
        { status: 402 }
      );
    }
    if (lastStatus === 403 || lastStatus === 404) {
      return NextResponse.json(
        {
          error: `OpenRouter refused model "${MODELS.join('", "')}"${msg ? `: ${msg}` : ""}. Usually an unsupported parameter in the payload (require_parameters drops every provider that lacks one) rather than the key — otherwise check the key's allowed models, or set OPENROUTER_MODEL.`,
        },
        { status: 502 }
      );
    }
    if (lastStatus === 429) {
      return NextResponse.json(
        { error: `OpenRouter rate limit hit${msg ? `: ${msg}` : ""}. Retry shortly or score fewer photos.` },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: `OpenRouter error ${lastStatus}${msg ? `: ${msg}` : ""}`, detail: lastBody.slice(0, 400) },
      { status: 502 }
    );
  }

  const raw = await aiRes.json();

  // A 200 can still carry an error payload.
  const inlineErr = bodyError(raw);
  if (inlineErr) {
    return NextResponse.json({ error: `OpenRouter: ${inlineErr}` }, { status: 502 });
  }

  const choice = raw?.choices?.[0];
  const text: string | undefined = choice?.message?.content ?? undefined;
  if (!text) {
    const reason = choice?.finish_reason || choice?.native_finish_reason;
    return NextResponse.json(
      { error: reason ? `Empty response from OpenRouter (${reason})` : "Empty response from OpenRouter" },
      { status: 502 }
    );
  }

  let parsed: { categories?: Record<string, { score: number; reason: string }>; summary?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    // Belt-and-braces: strict schema should prevent this, but extract the first {...} block.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "Model did not return JSON", raw: text.slice(0, 400) }, { status: 502 });
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return NextResponse.json({ error: "JSON parse failed", raw: text.slice(0, 400) }, { status: 502 });
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
