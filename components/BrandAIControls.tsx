"use client";

import { useState } from "react";
import { AIRubricResult, ImageAnalysis, SubBrand } from "@/lib/types";
import { BRAND_PROFILES } from "@/lib/brands";
import { runAIRubric, AIRubricError } from "@/lib/airubric";

const BRAND_ORDER: SubBrand[] = ["vieda", "villas", "veo", "vaana", "residences", "grams"];

type AIState = "idle" | "running" | "done" | "error";

export default function BrandAIControls({
  analyses,
  brand,
  onBrandChange,
  aiMode,
  onAIModeChange,
  ai,
  onAIResult,
}: {
  analyses: ImageAnalysis[];
  brand: SubBrand;
  onBrandChange: (b: SubBrand) => void;
  aiMode: "hybrid" | "full";
  onAIModeChange: (m: "hybrid" | "full") => void;
  ai: AIRubricResult | null;
  onAIResult: (r: AIRubricResult | null) => void;
}) {
  const [state, setState] = useState<AIState>(ai ? "done" : "idle");
  const [err, setErr] = useState<string>("");
  const profile = BRAND_PROFILES[brand];

  async function onRunAI() {
    setState("running");
    setErr("");
    try {
      const result = await runAIRubric(analyses, brand, aiMode);
      onAIResult(result);
      setState("done");
    } catch (e) {
      const ae = e as AIRubricError;
      setErr(ae?.error ?? "AI scoring failed");
      setState("error");
    }
  }

  return (
    <div className="card pad">
      <div className="toolbar" style={{ margin: "0 0 14px" }}>
        <strong>Sub-brand & AI scoring</strong>
        <span className="hint" style={{ margin: 0 }}>
          Pass bar: {profile.minScore}+ · vs {profile.comparableTo}
        </span>
      </div>

      <div className="row" style={{ gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <label className="small">Sub-brand standard</label>
          <select
            value={brand}
            onChange={(e) => {
              onBrandChange(e.target.value as SubBrand);
              onAIResult(null); // brand changed → previous AI scores no longer apply
              setState("idle");
            }}
          >
            {BRAND_ORDER.map((b) => (
              <option key={b} value={b}>
                {BRAND_PROFILES[b].name} — {BRAND_PROFILES[b].minScore}+
              </option>
            ))}
          </select>
          <div className="hint" style={{ marginTop: 6 }}>{profile.vibe}</div>
        </div>

        <div style={{ minWidth: 200 }}>
          <label className="small">AI rubric depth</label>
          <div className="seg">
            <button
              className={`seg-btn ${aiMode === "hybrid" ? "active" : ""}`}
              onClick={() => {
                onAIModeChange("hybrid");
                onAIResult(null);
                setState("idle");
              }}
            >
              Hybrid
            </button>
            <button
              className={`seg-btn ${aiMode === "full" ? "active" : ""}`}
              onClick={() => {
                onAIModeChange("full");
                onAIResult(null);
                setState("idle");
              }}
            >
              Full 6-cat
            </button>
          </div>
        </div>

        <div>
          <button onClick={onRunAI} disabled={state === "running"}>
            {state === "running"
              ? "Scoring with Gemini…"
              : ai
              ? "Re-run AI score"
              : "Run AI rubric score"}
          </button>
        </div>
      </div>

      <div className="hint" style={{ marginTop: 12 }}>
        {aiMode === "hybrid"
          ? "Hybrid: Gemini scores Cover, Set-ups & Lifestyle (styling/content); CV scores Lighting, Angles & Edits."
          : "Full: Gemini re-scores all six rubric categories; the in-browser CV score stays as a cross-check."}
      </div>

      {state === "done" && ai && (
        <div className="ai-summary">
          <span className="ai-badge">Gemini · {ai.mode}</span> {ai.summary}
        </div>
      )}
      {state === "error" && (
        <div className="error" style={{ marginTop: 12 }}>
          {err}
          {err.toLowerCase().includes("not configured") && (
            <div className="hint" style={{ marginTop: 6 }}>
              Add <code>GEMINI_API_KEY</code> in your Vercel project settings → Environment Variables, then redeploy.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
