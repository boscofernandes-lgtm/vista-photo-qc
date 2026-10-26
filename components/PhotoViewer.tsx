"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ImageAnalysis, PhotoVerdict } from "@/lib/types";
import { CATEGORY_LABEL, score01Color, shortFlag } from "@/lib/ui";

export interface ViewerItem {
  key: string;
  kind: "image" | "video";
  /** Proxied image URL, or the original URL for a video. */
  src: string;
  label?: string | null;
  /** 1-based position in the gallery. */
  number: number;
  analysis?: ImageAnalysis;
  verdict?: PhotoVerdict;
  isBestCover?: boolean;
  /** Shown when a photo has no QC result, e.g. it wasn't in the checked sample. */
  note?: string;
}

const ZOOM = 2.5;

const VERDICT_TEXT: Record<PhotoVerdict["verdict"], string> = {
  strong: "Listing-ready",
  ok: "Acceptable",
  improve: "Needs a fix",
};

/**
 * Large photo pop-up with zoom. Arrow keys / buttons move through the gallery,
 * Z or a click zooms in (the zoomed photo follows the pointer), Escape or a
 * click outside closes.
 */
export default function PhotoViewer({
  title,
  items,
  index,
  total,
  onIndexChange,
  onClose,
}: {
  title: string;
  items: ViewerItem[];
  index: number;
  /** Gallery size to show in "Photo 3 of N" (defaults to items.length). */
  total?: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const n = items.length;
  const item = items[Math.min(Math.max(index, 0), n - 1)];
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const closeRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Keep the latest handlers in refs so the key listener is attached once.
  const live = useRef({ index, n, onIndexChange, onClose });
  live.current = { index, n, onIndexChange, onClose };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => {
      const { index: i, n: count, onIndexChange: setIdx, onClose: close } = live.current;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight" && count > 1) {
        e.preventDefault();
        setIdx((i + 1) % count);
      } else if (e.key === "ArrowLeft" && count > 1) {
        e.preventDefault();
        setIdx((i - 1 + count) % count);
      } else if (e.key === "z" || e.key === "Z") {
        setZoom((z) => !z);
      } else if (e.key === "Tab") {
        // Keep keyboard focus inside the pop-up, like any modal dialog.
        const box = boxRef.current;
        const stops = box ? Array.from(box.querySelectorAll<HTMLElement>("button, video[controls]")) : [];
        if (!box || stops.length === 0) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        const inside = box.contains(document.activeElement);
        if (e.shiftKey && (!inside || document.activeElement === first)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      opener?.focus?.();
    };
  }, []);

  // A new photo starts un-zoomed. Keyed on the photo itself: the parent rebuilds
  // `items` on every render (e.g. each progress tick of a running check), and
  // resetting on that would snap the zoom back while someone is inspecting.
  const itemKey = item?.key;
  useEffect(() => {
    setZoom(false);
    setOrigin("50% 50%");
  }, [itemKey]);

  // Warm the neighbours so arrowing is instant.
  useEffect(() => {
    for (const d of [-1, 1]) {
      const it = itemsRef.current[(index + d + n) % n];
      if (it && it.kind === "image") {
        const pre = new Image();
        pre.crossOrigin = "anonymous";
        pre.src = it.src;
      }
    }
  }, [index, n]);

  if (!item) return null;

  const go = (d: number) => onIndexChange((index + d + n) % n);
  // Zoom centres on where the pointer is: a press (click or tap) aims, and
  // moving while zoomed pans.
  const aim = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    setOrigin(`${Math.min(100, Math.max(0, x))}% ${Math.min(100, Math.max(0, y))}%`);
  };
  const follow = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom) aim(e);
  };

  const a = item.analysis;
  const v = item.verdict;

  return (
    <div className="pv" role="dialog" aria-modal="true" aria-label={`${title}: photo ${item.number} of ${total ?? n}`}>
      <div className="pv-scrim" onClick={onClose} />
      <div className="pv-box" ref={boxRef}>
        <div className="pv-head">
          <div className="pv-title">
            <strong>{title}</strong>
            <span className="pv-count">
              Photo {item.number} of {total ?? n}
            </span>
            {item.label && <span className="badge">{item.label.trim()}</span>}
            {item.isBestCover && <span className="pv-best">Best cover pick</span>}
          </div>
          <div className="pv-actions">
            {item.kind === "image" && (
              <button type="button" className="ghost pv-btn" aria-pressed={zoom} onClick={() => setZoom((z) => !z)}>
                {zoom ? "Zoom out" : "Zoom in"}
              </button>
            )}
            <button ref={closeRef} type="button" className="ghost pv-btn pv-x" aria-label="Close photo viewer" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div
          className={`pv-stage ${zoom ? "zoomed" : ""} ${item.kind === "video" ? "is-video" : ""}`}
          onPointerMove={follow}
          onPointerDown={aim}
          onClick={() => item.kind === "image" && setZoom((z) => !z)}
        >
          {item.kind === "video" ? (
            <video key={item.key} src={item.src} controls preload="metadata" playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.key}
              src={item.src}
              alt={item.label ?? `Photo ${item.number}`}
              crossOrigin="anonymous"
              draggable={false}
              style={{ transformOrigin: origin, transform: zoom ? `scale(${ZOOM})` : "none" }}
            />
          )}
          {n > 1 && (
            <>
              <button
                type="button"
                className="pv-nav prev"
                aria-label="Previous photo"
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
              >
                ‹
              </button>
              <button
                type="button"
                className="pv-nav next"
                aria-label="Next photo"
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
              >
                ›
              </button>
            </>
          )}
        </div>

        <div className="pv-foot">
          {a && v ? (
            <>
              <span className={`pv-verdict ${v.verdict}`}>{VERDICT_TEXT[v.verdict]}</span>
              <span className="badge">{a.uncertain ? "Shot type uncertain" : CATEGORY_LABEL[a.clip.top]}</span>
              <span className="pv-scores">
                {(
                  [
                    ["Light", a.scores.lighting],
                    ["Angle", a.scores.angles],
                    ["Edit", a.scores.edits],
                  ] as const
                ).map(([label, s]) => (
                  <span key={label}>
                    {label} <b style={{ color: score01Color(s) }}>{Math.round(s * 100)}</b>
                  </span>
                ))}
              </span>
              {a.flags.length > 0 && (
                <span className="flags" style={{ margin: 0 }}>
                  {a.flags.map((f) => (
                    <span className="flag" key={f}>
                      {shortFlag(f)}
                    </span>
                  ))}
                </span>
              )}
            </>
          ) : (
            <span className="hint" style={{ margin: 0 }}>
              {item.note ?? (item.kind === "video" ? "Videos can’t be photo-checked." : "")}
            </span>
          )}
          <span className="pv-keys hint">← → to browse · Z to zoom · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
