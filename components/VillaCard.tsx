"use client";

import { useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  AIRubricResult,
  ImageAnalysis,
  PhotoVerdict,
  PropertyMeta,
  PropertyScore,
  Recommendations,
} from "@/lib/types";
import { VistaPhoto, isVideoUrl, proxied } from "@/lib/vistaApi";
import { gradeColor, shortFlag } from "@/lib/ui";

/** A search result, as returned by /api/properties?q=. */
export interface VillaSummary {
  id: number;
  name: string;
  city?: string;
  state?: string;
  propertyType?: string;
  rooms?: number;
  maxOccupancy?: number;
  photosCount: number;
  videoCount?: number;
  thumbnail?: string;
}

/** Where one villa's QC check is up to. */
export type VillaRun =
  | { status: "queued" }
  | { status: "running"; done: number; total: number }
  | { status: "done"; analyses: ImageAnalysis[]; meta: PropertyMeta; ai: AIRubricResult | null }
  | { status: "error"; error: string };

export interface Slide {
  key: string;
  kind: "image" | "video";
  /** Proxied image URL, or the original URL for a video. */
  src: string;
  tag: string | null;
}

/** The card's slides: the whole gallery in listing order once loaded, else the search thumbnail. */
export function slidesFor(villa: VillaSummary, photos: VistaPhoto[] | null): Slide[] {
  if (photos && photos.length) {
    return photos.map((ph, i) => {
      const kind = ph.kind ?? (isVideoUrl(ph.source) ? "video" : "image");
      return { key: `${villa.id}-${i}`, kind, src: kind === "video" ? ph.source : proxied(ph.source), tag: ph.tag };
    });
  }
  return villa.thumbnail ? [{ key: `${villa.id}-thumb`, kind: "image", src: villa.thumbnail, tag: null }] : [];
}

const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"
    />
  </svg>
);

const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function VillaCard({
  villa,
  photos,
  galleryFailed,
  run,
  score,
  rec,
  selected,
  index,
  queueAhead,
  onStep,
  onAnalyze,
  onShowReport,
  onOpenPhoto,
}: {
  villa: VillaSummary;
  /** Full gallery from /api/properties?ids=, or null while it loads. */
  photos: VistaPhoto[] | null;
  /** True when the full gallery couldn't be loaded (the card keeps its cover photo). */
  galleryFailed?: boolean;
  run?: VillaRun;
  /** Score under the current sub-brand / weights / AI result, once checked. */
  score: PropertyScore | null;
  rec: Recommendations | null;
  /** True when this villa's report is open in the side panel. */
  selected: boolean;
  /** Current carousel position (owned by the parent so the report can move it). */
  index: number;
  /** Villas ahead of this one in the check queue. */
  queueAhead: number;
  /** Move the carousel by `delta` photos (wrapping over `count`), from its latest position. */
  onStep: (delta: number, count: number) => void;
  onAnalyze: () => void;
  onShowReport: () => void;
  onOpenPhoto: (i: number) => void;
}) {
  const slides = useMemo(() => slidesFor(villa, photos), [villa, photos]);
  const n = slides.length;
  const i = n ? Math.min(Math.max(index, 0), n - 1) : 0;
  const slide = slides[i];
  const loaded = photos !== null;

  const verdictByIndex = useMemo(() => {
    const m = new Map<number, PhotoVerdict>();
    for (const v of rec?.verdicts ?? []) {
      if (v.image.input.listingIndex != null) m.set(v.image.input.listingIndex, v);
    }
    return m;
  }, [rec]);

  const go = (d: number) => {
    if (n > 1) onStep(d, n);
  };

  // A short tap opens the photo; a horizontal swipe changes it.
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current && Math.abs(e.clientX - drag.current.x) > 8) drag.current.moved = true;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    else if (!d.moved && slide) onOpenPhoto(i);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if ((e.key === "Enter" || e.key === " ") && slide) {
      e.preventDefault();
      onOpenPhoto(i);
    }
  };

  // ---- What the QC check said about the photo on screen ----
  let photoLine: ReactNode;
  if (!slide) {
    photoLine = <span className="vc-line muted">No photos on this listing</span>;
  } else if (run?.status !== "done" || !rec) {
    photoLine = (
      <span className="vc-line muted">
        {loaded ? "Click a photo to see it larger" : galleryFailed ? "Showing the cover photo only" : "Loading the full gallery…"}
      </span>
    );
  } else {
    const no = i + 1;
    const best = rec.hero?.image.input.listingIndex === i;
    const v = verdictByIndex.get(i);
    let text: ReactNode;
    if (slide.kind === "video") {
      text = <>Photo {no} is a video, so it isn’t checked</>;
    } else if (!v) {
      text = <>Photo {no} wasn’t among the {run.analyses.length} photos checked</>;
    } else if (v.verdict === "improve") {
      const issues = v.image.flags.length ? v.image.flags.map(shortFlag).join(", ") : "low overall quality";
      text = (
        <>
          <i className="vc-dot bad" /> Photo {no} needs a fix: {issues}
        </>
      );
    } else {
      text = (
        <>
          <i className={`vc-dot ${v.verdict === "strong" ? "good" : "ok"}`} /> Photo {no}:{" "}
          {v.verdict === "strong" ? "listing-ready" : "acceptable"}
        </>
      );
    }
    photoLine = (
      <span className={`vc-line ${!v ? "muted" : ""}`}>
        <span className="vc-line-text">{text}</span>
        {best && <span className="vc-best">Best cover pick</span>}
      </span>
    );
  }

  // ---- Status pill on the photo ----
  let pill: ReactNode;
  if (!run) pill = <span className="vc-pill idle">Not checked yet</span>;
  else if (run.status === "queued") pill = <span className="vc-pill idle">Queued</span>;
  else if (run.status === "running")
    pill = (
      <span className="vc-pill">
        <span className="spin" aria-hidden="true" />
        Checking {run.done}/{run.total}
      </span>
    );
  else if (run.status === "error") pill = <span className="vc-pill bad">Check failed</span>;
  else if (score)
    pill = (
      <span className="vc-pill">
        <span className="vc-dot" style={{ background: gradeColor(score.grade) }} />
        <b>{score.total100}</b>
        <small>/100</small>
      </span>
    );

  // ---- Footer: the one action that fits the current state ----
  let foot: ReactNode;
  if (!run) {
    foot = (
      <>
        <div className="vc-fl">
          <span className="vc-k">Photo QC</span>
          <span className="vc-v">Not checked yet</span>
        </div>
        <button type="button" onClick={onAnalyze} disabled={n === 0}>
          Analyze villa
        </button>
      </>
    );
  } else if (run.status === "queued") {
    foot = (
      <>
        <div className="vc-fl">
          <span className="vc-k">Queued</span>
          <span className="vc-v">
            {queueAhead > 0 ? `Starts after ${queueAhead} more villa${queueAhead === 1 ? "" : "s"}` : "Starting…"}
          </span>
        </div>
        <button type="button" disabled>
          Queued
        </button>
      </>
    );
  } else if (run.status === "running") {
    const pct = run.total ? (run.done / run.total) * 100 : 3;
    foot = (
      <div className="vc-run">
        <div className="vc-run-row" aria-live="polite">
          <span>Checking photos…</span>
          <span className="vc-num">
            {run.done} / {run.total}
          </span>
        </div>
        <div className="progress" aria-hidden="true">
          <div style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      </div>
    );
  } else if (run.status === "error") {
    foot = (
      <>
        <div className="vc-fl">
          <span className="vc-k badt">Check failed</span>
          <span className="vc-v">{run.error}</span>
        </div>
        <button type="button" onClick={onAnalyze}>
          Try again
        </button>
      </>
    );
  } else if (score) {
    const c = gradeColor(score.grade);
    foot = (
      <>
        <div className="vc-fl">
          <span className="vc-score" style={{ color: c }}>
            {score.total100}
            <small>/100</small>
          </span>
          <span className="vc-grade">
            {score.grade} ·{" "}
            <span className={score.pass ? "okt" : "badt"}>
              {score.pass ? `Passes ${score.threshold}+` : `Below ${score.threshold}+`}
            </span>
          </span>
          <span className="vc-todo">
            {score.reshootList.length === 0
              ? "No photos to fix"
              : `${score.reshootList.length} photo${score.reshootList.length === 1 ? "" : "s"} to fix`}
          </span>
        </div>
        <button
          type="button"
          className={`ghost vc-report ${selected ? "on" : ""}`}
          aria-pressed={selected}
          onClick={onShowReport}
        >
          {selected ? "Report open" : "See report"} <span aria-hidden="true">→</span>
        </button>
      </>
    );
  }

  const location = [villa.city, villa.state].filter(Boolean).join(", ");
  const facts = [
    villa.maxOccupancy ? `Up to ${villa.maxOccupancy} Guests` : null,
    villa.rooms ? `${villa.rooms} Rooms` : null,
    `${villa.photosCount} Photos`,
    villa.videoCount ? `${villa.videoCount} Video${villa.videoCount === 1 ? "" : "s"}` : null,
  ].filter((x): x is string => x !== null);

  return (
    <article className={`vcard ${selected ? "selected" : ""}`} aria-label={villa.name}>
      <div
        className="vc-gal"
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={`${villa.name} photos. Arrow keys browse, Enter enlarges.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      >
        <div className="vc-track" style={{ transform: `translateX(${-i * 100}%)` }}>
          {slides.map((s, k) => (
            <div className="vc-slide" key={s.key} aria-hidden={k !== i}>
              {Math.abs(k - i) <= 1 &&
                (s.kind === "video" ? (
                  <div className="vc-video">
                    <span className="vc-play" aria-hidden="true">▶</span>
                    <span>Video</span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.src}
                    alt={k === i ? `${villa.name}: ${s.tag?.trim() || "photo"} (${k + 1} of ${n})` : ""}
                    crossOrigin="anonymous"
                    draggable={false}
                    decoding="async"
                  />
                ))}
            </div>
          ))}
        </div>
        {n === 0 && <div className="vc-empty">No photos</div>}

        {pill}
        {slide && (
          <button type="button" className="vc-expand" aria-label="Enlarge this photo" onClick={() => onOpenPhoto(i)}>
            <ExpandIcon />
          </button>
        )}
        {loaded && slide && (
          <span className={`vc-tag ${slide.kind === "image" && !slide.tag ? "none" : ""}`}>
            {slide.kind === "video" ? "Video" : slide.tag?.trim() || "No room label"}
          </span>
        )}
        {slide && (i === 0 || loaded) && (
          <span className="vc-corner">{i === 0 ? "Cover now" : `${i + 1} / ${n}`}</span>
        )}
        {n > 1 && (
          <>
            <button type="button" className="vc-nav prev" aria-label="Previous photo" onClick={() => go(-1)}>
              ‹
            </button>
            <button type="button" className="vc-nav next" aria-label="Next photo" onClick={() => go(1)}>
              ›
            </button>
            <div className="vc-pos" aria-hidden="true">
              <i style={{ width: `${((i + 1) / n) * 100}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="vc-body">
        {photoLine}
        <h3 className="vc-name">{villa.name}</h3>
        {location && (
          <div className="vc-loc">
            <PinIcon />
            {location}
          </div>
        )}
        <div className="vc-meta">
          {facts.map((f, k) => (
            <span key={f}>
              {k > 0 && <i aria-hidden="true">✦</i>}
              {f}
            </span>
          ))}
        </div>
        <div className="vc-foot">{foot}</div>
      </div>
    </article>
  );
}
