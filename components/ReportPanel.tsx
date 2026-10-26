"use client";

import { useRef } from "react";
import { AIRubricResult, ImageAnalysis, PropertyMeta, SubBrand, Weights } from "@/lib/types";
import { scoreProperty } from "@/lib/scoring";
import { gradeColor } from "@/lib/ui";
import BrandAIControls from "./BrandAIControls";
import WeightsPanel from "./WeightsPanel";
import BenchmarkPanel from "./BenchmarkPanel";
import Recommendations from "./Recommendations";
import { PhotoClick, PhotoGrid, ReshootList, ScoreBreakdown, ScoreHero } from "./ScoreReport";

/**
 * The full QC report for one villa, laid out for the side panel: every section
 * of the full-width report (plus the sub-brand / AI and weights controls),
 * ordered so what you act on (the fix list, the cover pick) comes right after
 * the score, with a jump bar to every section.
 */
export default function ReportPanel({
  villaId,
  meta,
  analyses,
  weights,
  brand,
  ai,
  aiMode,
  onBrandChange,
  onAIModeChange,
  onAIResult,
  onWeightsChange,
  onClose,
  onPhotoClick,
}: {
  villaId: number;
  meta: PropertyMeta;
  analyses: ImageAnalysis[];
  weights: Weights;
  brand: SubBrand;
  ai: AIRubricResult | null;
  aiMode: "hybrid" | "full";
  onBrandChange: (b: SubBrand) => void;
  onAIModeChange: (m: "hybrid" | "full") => void;
  onAIResult: (r: AIRubricResult | null) => void;
  onWeightsChange: (w: Weights) => void;
  onClose: () => void;
  onPhotoClick: PhotoClick;
}) {
  const result = scoreProperty(analyses, weights, { brand, ai });
  const color = gradeColor(result.grade);
  const bodyRef = useRef<HTMLDivElement>(null);

  const sections = [
    { id: "summary", label: "Summary" },
    { id: "fix", label: `Fix list (${result.reshootList.length})` },
    { id: "reco", label: "Cover & order" },
    { id: "ai", label: "Sub-brand & AI" },
    { id: "breakdown", label: "Breakdown" },
    { id: "bench", label: "Benchmark" },
    { id: "photos", label: `All photos (${analyses.length})` },
    { id: "weights", label: "Weights" },
  ];

  const jump = (id: string) => {
    const body = bodyRef.current;
    const el = body?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!body || !el) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    body.scrollTo({ top: el.offsetTop - 6, behavior: smooth ? "smooth" : "auto" });
    // Move keyboard focus too, so the next Tab continues from that section.
    el.focus({ preventScroll: true });
  };

  const location = [meta.city, meta.state].filter(Boolean).join(", ");

  return (
    <div className="rp">
      <div className="rp-head">
        <div className="rp-head-top">
          <div className="rp-id">
            <div className="rp-kicker">QC report</div>
            <h2 className="rp-name">{meta.name}</h2>
            <div className="rp-sub">
              {location && <span>{location} · </span>}
              <span style={{ color }}>
                {result.total100}/100 · {result.grade}
              </span>
            </div>
          </div>
          <button type="button" className="ghost rp-close" aria-label="Close report" onClick={onClose}>
            ✕
          </button>
        </div>
        <nav className="rp-nav" aria-label="Report sections">
          {sections.map((s) => (
            <button key={s.id} type="button" className="rp-chip" onClick={() => jump(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="rp-body" ref={bodyRef}>
        <section tabIndex={-1} data-section="summary">
          <ScoreHero result={result} meta={meta} />
        </section>
        <section tabIndex={-1} data-section="fix">
          <ReshootList result={result} onPhotoClick={onPhotoClick} />
        </section>
        <section tabIndex={-1} data-section="reco">
          <Recommendations analyses={analyses} onPhotoClick={onPhotoClick} />
        </section>
        <section tabIndex={-1} data-section="ai">
          <BrandAIControls
            key={villaId}
            analyses={analyses}
            brand={brand}
            onBrandChange={onBrandChange}
            aiMode={aiMode}
            onAIModeChange={onAIModeChange}
            ai={ai}
            onAIResult={onAIResult}
          />
        </section>
        <section tabIndex={-1} data-section="breakdown">
          <ScoreBreakdown result={result} />
        </section>
        <section tabIndex={-1} data-section="bench">
          <BenchmarkPanel result={result} brand={brand} />
        </section>
        <section tabIndex={-1} data-section="photos">
          <PhotoGrid analyses={analyses} onPhotoClick={onPhotoClick} />
        </section>
        <section tabIndex={-1} data-section="weights">
          <WeightsPanel weights={weights} onChange={onWeightsChange} />
        </section>
      </div>
    </div>
  );
}
