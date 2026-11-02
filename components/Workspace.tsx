"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { PhotoVerdict, SubBrand, Weights } from "@/lib/types";
import VillaCard, { VillaEntry, slidesOf } from "./VillaCard";
import ReportPanel from "./ReportPanel";
import PhotoViewer, { ViewerItem } from "./PhotoViewer";
import type { VillaChecks } from "./useVillaChecks";
import { MIN_PANEL_WIDTH, setPanelWidth, usePanelWidth } from "./panelSize";

/** Room kept for the cards beside the report: one card column plus the gap (matches globals.css). */
const MIN_CARDS_WIDTH = 322;
/** How far one arrow-key press moves the report's edge. */
const KEY_STEP = 40;

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

  // ---- Report size: drag (or arrow-key) the panel's left edge, or maximize it ----
  const panelWidth = usePanelWidth();
  const [maximized, setMaximized] = useState(false);
  const isMax = maximized && selectedKey != null;
  const layoutRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const resizing = useRef<{ x: number; w: number; now: number } | null>(null);

  // A closed report reopens at its normal size.
  useEffect(() => {
    if (selectedKey == null) setMaximized(false);
  }, [selectedKey]);

  // Esc restores a maximized report (the photo viewer handles its own Esc).
  useEffect(() => {
    if (!isMax || viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isMax, viewer]);

  const clampWidth = (w: number) => {
    const room = (layoutRef.current?.clientWidth ?? window.innerWidth) - MIN_CARDS_WIDTH;
    return Math.round(Math.min(Math.max(w, MIN_PANEL_WIDTH), Math.max(MIN_PANEL_WIDTH, room)));
  };
  const currentWidth = () => asideRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH;

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Keep resizing even if capture isn't available.
    }
    const w = currentWidth();
    resizing.current = { x: e.clientX, w, now: w };
    document.body.classList.add("resizing");
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizing.current;
    if (!r) return;
    // Live preview without re-rendering every card; saved on release.
    r.now = clampWidth(r.w + (r.x - e.clientX));
    layoutRef.current?.style.setProperty("--rp-w", `${r.now}px`);
    layoutRef.current?.classList.add("sized");
  };
  const onResizeUp = () => {
    const r = resizing.current;
    if (!r) return;
    resizing.current = null;
    document.body.classList.remove("resizing");
    // A click without a drag leaves the width alone (so double-click can reset it).
    if (r.now !== r.w) setPanelWidth(r.now);
  };
  const onResizeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let w: number | null;
    if (e.key === "ArrowLeft") w = clampWidth(currentWidth() + KEY_STEP); // the edge moves left: wider
    else if (e.key === "ArrowRight") w = clampWidth(currentWidth() - KEY_STEP);
    else if (e.key === "Home") w = clampWidth(Number.MAX_SAFE_INTEGER);
    else if (e.key === "End") w = MIN_PANEL_WIDTH;
    else if (e.key === "Enter") w = null;
    else return;
    e.preventDefault();
    setPanelWidth(w);
  };

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
        maximized={isMax}
        onToggleMaximize={() => setMaximized((m) => !m)}
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
      <div
        ref={layoutRef}
        className={`browse ${selectedKey != null ? "has-report" : ""} ${panelWidth != null ? "sized" : ""}`}
        style={panelWidth != null ? ({ "--rp-w": `${panelWidth}px` } as CSSProperties) : undefined}
      >
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
        <aside
          ref={asideRef}
          className={`report-panel ${selectedKey != null ? "open" : ""} ${isMax ? "max" : ""}`}
          aria-label="QC report"
        >
          {selectedKey != null && !isMax && (
            <div
              className="rp-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize report. Arrow keys change the width, Enter resets it."
              title="Drag to resize · double-click to reset"
              tabIndex={0}
              aria-valuemin={MIN_PANEL_WIDTH}
              aria-valuenow={panelWidth ?? undefined}
              onPointerDown={onResizeDown}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onDoubleClick={() => setPanelWidth(null)}
              onKeyDown={onResizeKey}
            />
          )}
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
