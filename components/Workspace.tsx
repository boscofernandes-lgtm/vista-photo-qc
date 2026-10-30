"use client";

import { ReactNode } from "react";
import { PhotoVerdict, SubBrand, Weights } from "@/lib/types";
import VillaCard, { VillaEntry, slidesOf } from "./VillaCard";
import ReportPanel from "./ReportPanel";
import PhotoViewer, { ViewerItem } from "./PhotoViewer";
import type { VillaChecks } from "./useVillaChecks";

/**
 * The layout every tab shares: villa cards with photo carousels on the left,
 * the selected villa's full QC report in a panel on the right (full-screen on
 * phones/tablets), the photo viewer, and the "villa is checked" toast.
 */
export default function Workspace({
  entries,
  lookup,
  ws,
  brand,
  onBrandChange,
  weights,
  onWeightsChange,
  aiMode,
  onAIModeChange,
  bar,
  emptyText,
}: {
  /** The cards to show, in display order. */
  entries: VillaEntry[];
  /** Any villa this tab knows about (the open report can belong to one no longer listed). */
  lookup: (key: string) => VillaEntry | undefined;
  ws: VillaChecks;
  brand: SubBrand;
  onBrandChange: (b: SubBrand) => void;
  weights: Weights;
  onWeightsChange: (w: Weights) => void;
  aiMode: "hybrid" | "full";
  onAIModeChange: (m: "hybrid" | "full") => void;
  /** Line above the cards (match count, batch progress…). */
  bar?: ReactNode;
  /** What the empty report panel says. */
  emptyText: ReactNode;
}) {
  const { runs, scored, queue, selectedKey, setSelectedKey, viewer } = ws;

  // ---- Photo viewer: the villa's whole gallery, with QC results where there are any ----
  function viewerItems(key: string): ViewerItem[] {
    const entry = lookup(key);
    if (!entry) return [];
    const run = runs[key];
    const rec = scored[key]?.rec;
    const byIndex = new Map<number, PhotoVerdict>();
    for (const v of rec?.verdicts ?? []) {
      if (v.image.input.listingIndex != null) byIndex.set(v.image.input.listingIndex, v);
    }
    const heroIndex = rec?.hero?.image.input.listingIndex;
    const checked = run?.status === "done" ? run.analyses.length : 0;
    return slidesOf(entry).map((s, k) => {
      const v = byIndex.get(k);
      return {
        key: s.key,
        kind: s.kind,
        src: s.src,
        label: s.kind === "video" ? "Video" : s.label,
        number: k + 1,
        analysis: v?.image,
        verdict: v,
        isBestCover: heroIndex === k,
        note:
          s.kind === "video"
            ? "Videos can’t be photo-checked."
            : run?.status === "done"
              ? `Not among the ${checked} photos checked.`
              : "Press Analyze villa to check this villa’s photos.",
      };
    });
  }

  const selectedRun = selectedKey != null ? runs[selectedKey] : undefined;
  const selectedEntry = selectedKey != null ? lookup(selectedKey) : undefined;
  const viewerList = viewer ? viewerItems(viewer.key) : [];

  const closePanel = (
    <button type="button" className="ghost rp-close rp-empty-close" aria-label="Close" onClick={() => setSelectedKey(null)}>
      ✕
    </button>
  );

  let panel: ReactNode;
  if (selectedKey != null && selectedRun?.status === "done" && selectedEntry) {
    const key = selectedKey;
    panel = (
      <ReportPanel
        key={key}
        villaKey={key}
        summary={selectedEntry.summary}
        meta={{ ...selectedRun.meta, sourceUrl: selectedRun.meta.sourceUrl ?? selectedEntry.sourceUrl }}
        analyses={selectedRun.analyses}
        gallery={selectedEntry.photos ?? []}
        order={ws.orders[key]}
        weights={weights}
        brand={brand}
        // AI scores only count under the sub-brand they were judged against.
        ai={selectedRun.aiBrand === brand ? selectedRun.ai : null}
        aiMode={aiMode}
        onBrandChange={onBrandChange}
        onAIModeChange={onAIModeChange}
        onAIResult={(r) => ws.setAI(key, r)}
        onWeightsChange={onWeightsChange}
        onOrderChange={(keys) => ws.setOrder(key, keys)}
        download={ws.downloads[key] ?? { state: "idle" }}
        onDownloadChange={(d) => ws.setDownload(key, d)}
        onClose={() => setSelectedKey(null)}
        onPhotoClick={(a) => {
          if (a.input.listingIndex != null) ws.showPhoto(key, a.input.listingIndex);
        }}
        onOpenGalleryPhoto={(i) => ws.showPhoto(key, i)}
      />
    );
  } else if (selectedKey != null && (selectedRun?.status === "running" || selectedRun?.status === "queued")) {
    panel = (
      <div className="rp-empty">
        {closePanel}
        <span className="spin" aria-hidden="true" />
        <h3>Checking {selectedEntry?.summary.name ?? "this villa"}…</h3>
        <p>
          {selectedRun.status === "running" && selectedRun.ai
            ? "Photos checked; the AI rubric is scoring now. "
            : selectedRun.status === "running" && selectedRun.total > 0
            ? `${selectedRun.done} of ${selectedRun.total} photos checked. `
            : selectedRun.status === "running"
              ? "Loading the listing. "
              : "Waiting for the villa ahead of it to finish. "}
          The report opens here as soon as the check is done.
        </p>
      </div>
    );
  } else if (selectedKey != null && selectedRun?.status === "error") {
    const key = selectedKey;
    panel = (
      <div className="rp-empty">
        {closePanel}
        <h3>Couldn’t check {selectedEntry?.summary.name ?? "this villa"}</h3>
        <p>{selectedRun.error}</p>
        <button type="button" onClick={() => ws.analyze(key)}>
          Try again
        </button>
      </div>
    );
  } else {
    panel = (
      <div className="rp-empty">
        <h3>Reports open here</h3>
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <>
      <div className={`browse ${selectedKey != null ? "has-report" : ""}`}>
        <div className="browse-main">
          {bar}
          <div className="villa-grid">
            {entries.map((e) => {
              const qPos = queue.indexOf(e.key);
              return (
                <VillaCard
                  key={e.key}
                  entry={e}
                  run={runs[e.key]}
                  score={scored[e.key]?.score ?? null}
                  rec={scored[e.key]?.rec ?? null}
                  selected={selectedKey === e.key}
                  index={ws.slideIdx[e.key] ?? 0}
                  queueAhead={qPos > 0 ? qPos : 0}
                  onStep={(d, count) => ws.step(e.key, d, count)}
                  onAnalyze={() => ws.analyze(e.key)}
                  onShowReport={() => setSelectedKey(e.key)}
                  onOpenPhoto={(i) => ws.showPhoto(e.key, i)}
                />
              );
            })}
          </div>
        </div>
        <aside className={`report-panel ${selectedKey != null ? "open" : ""}`} aria-label="QC report">
          {panel}
        </aside>
      </div>

      {viewer && viewerList.length > 0 && (
        <PhotoViewer
          title={lookup(viewer.key)?.summary.name ?? "Photos"}
          items={viewerList}
          index={viewer.index}
          onIndexChange={(i) => ws.showPhoto(viewer.key, i)}
          onClose={() => ws.setViewer(null)}
        />
      )}

      {ws.toast && (
        <div className="toast" role="status">
          <span>{ws.toast.text}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setSelectedKey(ws.toast!.key);
              ws.setToast(null);
            }}
          >
            See report
          </button>
        </div>
      )}
    </>
  );
}
