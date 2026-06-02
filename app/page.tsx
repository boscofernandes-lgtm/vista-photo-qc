"use client";

import { useState } from "react";
import { analyzeBatch, AnalyzeProgress } from "@/lib/analyze";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";
import { DEFAULT_BRAND } from "@/lib/brands";
import { AIRubricResult, ImageAnalysis, ImageInput, PropertyMeta, SubBrand, Weights } from "@/lib/types";
import WeightsPanel from "@/components/WeightsPanel";
import ScoreReport from "@/components/ScoreReport";
import BrandAIControls from "@/components/BrandAIControls";
import PropertyPicker from "@/components/PropertyPicker";
import { VistaProperty, toImageInputs, toMeta } from "@/lib/vistaApi";

type Status = "idle" | "scraping" | "analyzing" | "done" | "error";

export default function Home() {
  const [mode, setMode] = useState<"browse" | "url" | "upload">("browse");
  const [url, setUrl] = useState(
    "https://www.stayvista.com/villa/the-stone-house-in-beze-2-bhk-villa-in-nashik-with-spacious-rooms"
  );
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<AnalyzeProgress>({ done: 0, total: 0 });
  const [error, setError] = useState<string>("");
  const [meta, setMeta] = useState<PropertyMeta | null>(null);
  const [analyses, setAnalyses] = useState<ImageAnalysis[] | null>(null);
  const [weights, setWeights] = useState<Weights>(() => JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)));
  const [brand, setBrand] = useState<SubBrand>(DEFAULT_BRAND);
  const [aiMode, setAiMode] = useState<"hybrid" | "full">("hybrid");
  const [ai, setAi] = useState<AIRubricResult | null>(null);

  const busy = status === "scraping" || status === "analyzing";

  async function run(inputs: ImageInput[], m: PropertyMeta) {
    if (inputs.length === 0) {
      setError("No images found to analyze.");
      setStatus("error");
      return;
    }
    setMeta(m);
    setAi(null);
    setStatus("analyzing");
    setProgress({ done: 0, total: inputs.length });
    const results = await analyzeBatch(inputs, setProgress);
    if (results.length === 0) {
      setError("Could not read any of the photos. They may be blocked or in an unsupported format — try the upload option.");
      setStatus("error");
      return;
    }
    setAnalyses(results);
    setStatus("done");
  }

  async function onAnalyzeUrl() {
    setError("");
    setAnalyses(null);
    setStatus("scraping");
    try {
      const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scrape failed");
      const inputs: ImageInput[] = data.images.map((i: any) => ({
        id: i.id,
        src: i.src,
        originalUrl: i.originalUrl,
        label: i.label,
        source: "url" as const,
      }));
      await run(inputs, data.meta as PropertyMeta);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
      setStatus("error");
    }
  }

  async function onSelectProperty(p: VistaProperty) {
    setError("");
    setAnalyses(null);
    const inputs = toImageInputs(p);
    await run(inputs, toMeta(p));
  }

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setAnalyses(null);
    const inputs: ImageInput[] = Array.from(files).map((f, idx) => ({
      id: `up-${idx}`,
      src: URL.createObjectURL(f),
      label: f.name,
      source: "upload" as const,
    }));
    await run(inputs, { name: "Uploaded photo set" });
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="dot" />
          <h1>StayVista FrameCheck</h1>
        </div>
        <div className="cobrand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/stayvista-logo.png" alt="StayVista" className="cobrand-logo" />
        </div>
      </div>
      <p className="subtitle">
        Automated hospitality photography quality control — scores any property against the
        StayVista rubric, fully in your browser.
      </p>

      <div className="card pad">
        <div className="tabs">
          <div className={`tab ${mode === "browse" ? "active" : ""}`} onClick={() => setMode("browse")}>
            Browse StayVista
          </div>
          <div className={`tab ${mode === "url" ? "active" : ""}`} onClick={() => setMode("url")}>
            From StayVista URL
          </div>
          <div className={`tab ${mode === "upload" ? "active" : ""}`} onClick={() => setMode("upload")}>
            Upload photos
          </div>
        </div>

        {mode === "browse" ? (
          <PropertyPicker onSelect={onSelectProperty} busy={busy} />
        ) : mode === "url" ? (
          <div className="row">
            <div className="grow">
              <label className="small">StayVista villa URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.stayvista.com/villa/..."
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button onClick={onAnalyzeUrl} disabled={busy}>
                {status === "scraping" ? "Fetching…" : busy ? "Analyzing…" : "Analyze"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className="small">Select property photos</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => onUpload(e.target.files)}
              disabled={busy}
            />
          </div>
        )}

        <div className="toolbar" style={{ margin: "14px 0 0" }}>
          <span className="hint" style={{ margin: 0 }}>
            StayVista listings score instantly in your browser — no setup, no uploads, no model download.
          </span>
        </div>

        {busy && (
          <div style={{ marginTop: 16 }}>
            <div className="progress">
              <div style={{ width: `${status === "scraping" ? 8 : pct}%` }} />
            </div>
            <div className="hint">
              {status === "scraping"
                ? "Reading property data…"
                : `Analyzed ${progress.done} / ${progress.total}${
                    progress.current ? ` · ${progress.current}` : ""
                  }`}
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
      </div>

      {status === "done" && analyses && analyses.length > 0 && meta && (
        <div style={{ marginTop: 22 }}>
          <BrandAIControls
            analyses={analyses}
            brand={brand}
            onBrandChange={setBrand}
            aiMode={aiMode}
            onAIModeChange={setAiMode}
            ai={ai}
            onAIResult={setAi}
          />
          <div style={{ height: 18 }} />
          <WeightsPanel weights={weights} onChange={setWeights} />
          <div style={{ height: 18 }} />
          <ScoreReport meta={meta} analyses={analyses} weights={weights} brand={brand} ai={ai} />
        </div>
      )}
    </div>
  );
}
