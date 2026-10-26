"use client";

import { useState } from "react";
import { analyzeBatch, AnalyzeProgress } from "@/lib/analyze";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";
import { DEFAULT_BRAND } from "@/lib/brands";
import { recommend } from "@/lib/recommend";
import { AIRubricResult, ImageAnalysis, ImageInput, PropertyMeta, SubBrand, Weights } from "@/lib/types";
import WeightsPanel from "@/components/WeightsPanel";
import ScoreReport from "@/components/ScoreReport";
import BrandAIControls from "@/components/BrandAIControls";
import BrowseView from "@/components/BrowseView";
import BulkRunner from "@/components/BulkRunner";
import PhotoViewer, { ViewerItem } from "@/components/PhotoViewer";

type Status = "idle" | "scraping" | "analyzing" | "done" | "error";
type Mode = "browse" | "url" | "upload" | "bulk";

const MODES: { id: Mode; label: string }[] = [
  { id: "browse", label: "Browse StayVista" },
  { id: "url", label: "From StayVista URL" },
  { id: "upload", label: "Upload photos" },
  { id: "bulk", label: "Bulk QC" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("browse");
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
  const [viewIndex, setViewIndex] = useState<number | null>(null);

  const busy = status === "scraping" || status === "analyzing";

  // The sub-brand is shared by every tab, and AI scores are judged against one
  // sub-brand, so a change from any tab drops this report's AI score (Browse
  // clears its own villas' AI scores when it sees the new sub-brand).
  const changeBrand = (b: SubBrand) => {
    setBrand(b);
    setAi(null);
  };

  async function run(inputs: ImageInput[], m: PropertyMeta) {
    if (inputs.length === 0) {
      setError("No images found to analyze.");
      setStatus("error");
      return;
    }
    setMeta(m);
    setAi(null);
    setViewIndex(null);
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
        listingIndex: typeof i.listingIndex === "number" ? i.listingIndex : undefined,
      }));
      await run(inputs, data.meta as PropertyMeta);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
      setStatus("error");
    }
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
      listingIndex: idx,
    }));
    await run(inputs, { name: "Uploaded photo set" });
  }

  // Photo viewer for the URL / Upload report: the analysed photos with their verdicts.
  function viewerItems(list: ImageAnalysis[]): ViewerItem[] {
    const rec = recommend(list);
    const verdicts = new Map(rec.verdicts.map((v) => [v.image, v]));
    return list.map((a, i) => ({
      key: a.input.id,
      kind: "image" as const,
      src: a.input.src,
      label: a.input.label ?? null,
      number: (a.input.listingIndex ?? i) + 1,
      analysis: a,
      verdict: verdicts.get(a),
      isBestCover: rec.hero?.image === a,
    }));
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const tabs = (
    <div className="tabs" role="tablist" aria-label="How to find photos">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={`tab ${mode === m.id ? "active" : ""}`}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`container ${mode === "browse" ? "wide" : ""}`}>
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

      {/* Browse stays mounted while other tabs are open, so finished checks aren't lost. */}
      <div hidden={mode !== "browse"}>
        <BrowseView
          tabs={tabs}
          brand={brand}
          onBrandChange={changeBrand}
          weights={weights}
          onWeightsChange={setWeights}
          aiMode={aiMode}
          onAIModeChange={setAiMode}
        />
      </div>

      {mode !== "browse" && (
        <>
          <div className="card pad">
            {tabs}

            {mode === "url" ? (
              <div className="row">
                <div className="grow">
                  <label className="small" htmlFor="villa-url">
                    StayVista villa URL
                  </label>
                  <input
                    id="villa-url"
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
            ) : mode === "upload" ? (
              <div>
                <label className="small" htmlFor="photo-files">
                  Select property photos
                </label>
                <input
                  id="photo-files"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => onUpload(e.target.files)}
                  disabled={busy}
                />
              </div>
            ) : (
              <BulkRunner />
            )}

            {mode !== "bulk" && (
              <div className="toolbar" style={{ margin: "14px 0 0" }}>
                <span className="hint" style={{ margin: 0 }}>
                  Photos are scored in your browser — nothing is uploaded.
                </span>
              </div>
            )}

            {busy && mode !== "bulk" && (
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

            {error && mode !== "bulk" && <div className="error">{error}</div>}
          </div>

          {mode !== "bulk" && status === "done" && analyses && analyses.length > 0 && meta && (
            <div style={{ marginTop: 22 }}>
              <BrandAIControls
                analyses={analyses}
                brand={brand}
                onBrandChange={changeBrand}
                aiMode={aiMode}
                onAIModeChange={setAiMode}
                ai={ai}
                onAIResult={setAi}
              />
              <div style={{ height: 18 }} />
              <WeightsPanel weights={weights} onChange={setWeights} />
              <div style={{ height: 18 }} />
              <ScoreReport
                meta={meta}
                analyses={analyses}
                weights={weights}
                brand={brand}
                ai={ai}
                onPhotoClick={(a) => setViewIndex(analyses.indexOf(a))}
              />
            </div>
          )}

          {viewIndex !== null && analyses && analyses[viewIndex] && meta && (
            <PhotoViewer
              title={meta.name}
              items={viewerItems(analyses)}
              index={viewIndex}
              total={Math.max(analyses.length, ...analyses.map((a, i) => (a.input.listingIndex ?? i) + 1))}
              onIndexChange={setViewIndex}
              onClose={() => setViewIndex(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
