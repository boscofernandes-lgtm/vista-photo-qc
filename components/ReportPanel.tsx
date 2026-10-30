"use client";

import { useMemo, useRef } from "react";
import { AIRubricResult, ImageAnalysis, PhotoVerdict, PropertyMeta, SubBrand, Weights } from "@/lib/types";
import { scoreProperty } from "@/lib/scoring";
import { recommend } from "@/lib/recommend";
import { gradeColor } from "@/lib/ui";
import { GalleryPhoto, arrangeStills } from "@/lib/gallery";
import BrandAIControls from "./BrandAIControls";
import WeightsPanel from "./WeightsPanel";
import BenchmarkPanel from "./BenchmarkPanel";
import Recommendations from "./Recommendations";
import CityPageView from "./CityPageView";
import GalleryOrganizer from "./GalleryOrganizer";
import { PhotoClick, PhotoGrid, ReshootList, ScoreBreakdown, ScoreHero } from "./ScoreReport";
import type { VillaSummary } from "./VillaCard";
import type { Download } from "./useVillaChecks";

/**
 * The full QC report for one villa, laid out for the side panel: every section
 * of the full report (plus the sub-brand / AI and weights controls), ordered so
 * what you act on (the fix list, the cover and the photo order) comes right
 * after the score, with a jump bar to every section.
 */
export default function ReportPanel({
  villaKey,
  summary,
  meta,
  analyses,
  gallery,
  order,
  weights,
  brand,
  ai,
  aiMode,
  onBrandChange,
  onAIModeChange,
  onAIResult,
  onWeightsChange,
  onOrderChange,
  download,
  onDownloadChange,
  onClose,
  onPhotoClick,
  onOpenGalleryPhoto,
}: {
  villaKey: string;
  summary: VillaSummary;
  meta: PropertyMeta;
  analyses: ImageAnalysis[];
  /** The villa's whole gallery in listing order (photos and videos). */
  gallery: GalleryPhoto[];
  /** The arranged photo order (gallery keys), when the user has changed it. */
  order: string[] | undefined;
  weights: Weights;
  brand: SubBrand;
  ai: AIRubricResult | null;
  aiMode: "hybrid" | "full";
  onBrandChange: (b: SubBrand) => void;
  onAIModeChange: (m: "hybrid" | "full") => void;
  onAIResult: (r: AIRubricResult | null) => void;
  onWeightsChange: (w: Weights) => void;
  onOrderChange: (keys: string[] | null) => void;
  /** This villa's download job (kept by the engine, so it survives the panel closing). */
  download: Download;
  onDownloadChange: (d: Download) => void;
  onClose: () => void;
  onPhotoClick: PhotoClick;
  /** Open the photo viewer at a gallery position. */
  onOpenGalleryPhoto: (galleryIndex: number) => void;
}) {
  const result = scoreProperty(analyses, weights, { brand, ai });
  const color = gradeColor(result.grade);
  const bodyRef = useRef<HTMLDivElement>(null);

  // ---- Photo arrangement (city page preview, organiser, download) ----
  const arranged = useMemo(() => arrangeStills(gallery, order), [gallery, order]);
  const galleryIndex = useMemo(() => new Map(gallery.map((g, i) => [g.key, i])), [gallery]);
  const numberOf = (key: string) => (galleryIndex.get(key) ?? 0) + 1;
  const rec = useMemo(() => recommend(analyses), [analyses]);
  const verdicts = useMemo(() => {
    // Analyser ids are gallery keys, so verdicts map straight onto tiles.
    const m = new Map<string, PhotoVerdict>();
    for (const v of rec.verdicts) m.set(v.image.input.id, v);
    return m;
  }, [rec]);
  const suggested = rec.order.length ? rec.order.map((o) => o.image.input.id) : null;
  const listingOrder = useMemo(() => gallery.filter((g) => g.kind === "image").map((g) => g.key), [gallery]);
  const listingPos = useMemo(() => new Map(listingOrder.map((k, i) => [k, i])), [listingOrder]);
  const isCustom = arranged.some((g, i) => g.key !== listingOrder[i]);
  const videoCount = gallery.length - listingOrder.length;
  const openKey = (key: string) => {
    const i = galleryIndex.get(key);
    if (i != null) onOpenGalleryPhoto(i);
  };

  const sections = [
    { id: "summary", label: "Summary" },
    { id: "fix", label: `Fix list (${result.reshootList.length})` },
    { id: "city", label: "City page" },
    { id: "arrange", label: `Arrange & download (${arranged.length})` },
    { id: "reco", label: "Cover & order" },
    { id: "ai", label: "Sub-brand & AI" },
    { id: "breakdown", label: "Breakdown" },
    { id: "bench", label: "Benchmark" },
    { id: "photos", label: `Photo scores (${analyses.length})` },
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

  const location = [meta.city ?? summary.city, meta.state ?? summary.state].filter(Boolean).join(", ");

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
        <section tabIndex={-1} data-section="city">
          <div className="section-title">City page view</div>
          <CityPageView
            photos={arranged}
            name={meta.name}
            location={location || undefined}
            guests={summary.maxOccupancy}
            rooms={summary.rooms}
            sourceUrl={meta.sourceUrl}
            numberOf={numberOf}
            onOpen={openKey}
          />
        </section>
        <section tabIndex={-1} data-section="arrange">
          <div className="section-title">Arrange the gallery &amp; download</div>
          <GalleryOrganizer
            villaName={meta.name}
            photos={arranged}
            numberOf={numberOf}
            listingPosOf={(k) => listingPos.get(k) ?? -1}
            verdictOf={(k) => verdicts.get(k)}
            suggested={suggested}
            isCustom={isCustom}
            videoCount={videoCount}
            download={download}
            onDownloadChange={onDownloadChange}
            onReorder={(keys) => onOrderChange(keys)}
            onReset={() => onOrderChange(null)}
            onOpen={openKey}
          />
        </section>
        <section tabIndex={-1} data-section="reco">
          <Recommendations analyses={analyses} onPhotoClick={onPhotoClick} />
        </section>
        <section tabIndex={-1} data-section="ai">
          <BrandAIControls
            key={villaKey}
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
