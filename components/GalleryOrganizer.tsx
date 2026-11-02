"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { GalleryPhoto } from "@/lib/gallery";
import { PhotoVerdict } from "@/lib/types";
import { MAX_PHOTO_BYTES, fileSlug, zipPhotosInOrder } from "@/lib/exportPhotos";
import { shortFlag } from "@/lib/ui";
import type { Download } from "./useVillaChecks";

const VERDICT_TEXT: Record<PhotoVerdict["verdict"], string> = {
  strong: "Listing-ready",
  ok: "Acceptable",
  improve: "Needs a fix",
};

type MoveAction = "earlier" | "cover" | "later";

/**
 * Every photo of the villa as a tile, in the arranged order. Drag a tile (or use
 * its arrow buttons) to re-order; the first tile is the cover. "Download photos
 * in this order" saves them as numbered JPEGs of 499 KB or less, ready for the
 * listing team. The order is locked while a download is being prepared, so the
 * zip always matches what's on screen.
 */
export default function GalleryOrganizer({
  villaName,
  photos,
  numberOf,
  listingPosOf,
  verdictOf,
  suggested,
  isCustom,
  videoCount,
  download,
  onDownloadChange,
  onReorder,
  onReset,
  onOpen,
}: {
  villaName: string;
  /** Still photos in the arranged order. */
  photos: GalleryPhoto[];
  /** 1-based gallery number of a photo, as it is on the listing today. */
  numberOf: (key: string) => number;
  /** 0-based place of a photo in the listing's current photo order (videos not counted). */
  listingPosOf: (key: string) => number;
  verdictOf: (key: string) => PhotoVerdict | undefined;
  /** The QC check's suggested running order (gallery keys), when there is one. */
  suggested: string[] | null;
  /** True when the arrangement differs from the listing's current order. */
  isCustom: boolean;
  videoCount: number;
  /** This villa's download job, kept by the check engine so it outlives this panel. */
  download: Download;
  onDownloadChange: (d: Download) => void;
  onReorder: (keys: string[]) => void;
  onReset: () => void;
  onOpen: (key: string) => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  /** The move button to give focus back to once the moved tile re-renders. */
  const refocus = useRef<{ key: string; act: MoveAction } | null>(null);
  const keys = photos.map((p) => p.key);
  const n = photos.length;
  const dl = download;
  const busy = dl.state === "working";

  // A finished download's message describes the old order once anything moves.
  const clearResult = () => {
    if (dl.state === "done" || dl.state === "error") onDownloadChange({ state: "idle" });
  };

  function move(key: string, to: number) {
    if (busy) return;
    const from = keys.indexOf(key);
    if (from < 0 || to < 0 || to >= n || to === from) return;
    const next = keys.filter((k) => k !== key);
    next.splice(to, 0, key);
    onReorder(next);
    clearResult();
    setAnnounce(`Photo moved to position ${to + 1} of ${n}${to === 0 ? ", now the cover" : ""}.`);
  }

  // Keep keyboard focus on the same control of the photo that just moved.
  useLayoutEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    const li = rootRef.current?.querySelector(`li[data-key="${CSS.escape(r.key)}"]`);
    li?.querySelector<HTMLElement>(`button[data-act="${r.act}"]`)?.focus();
  }, [keys.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (key: string, act: MoveAction, to: number) => {
    // An aria-disabled button still gets clicks; ignore them.
    if (busy || to < 0 || to >= n || to === keys.indexOf(key)) return;
    refocus.current = { key, act };
    move(key, to);
  };

  // Dropping on a tile takes its place: moving forward lands after it, moving back lands before it.
  const onDragStart = (e: ReactDragEvent<HTMLLIElement>, key: string) => {
    if (busy) {
      e.preventDefault();
      return;
    }
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  };
  const onDragOver = (e: ReactDragEvent<HTMLLIElement>, key: string) => {
    if (busy) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overKey !== key) setOverKey(key);
  };
  const onDrop = (e: ReactDragEvent<HTMLLIElement>, key: string) => {
    e.preventDefault();
    const from = dragKey ?? e.dataTransfer.getData("text/plain");
    if (from && from !== key) move(from, keys.indexOf(key));
    setDragKey(null);
    setOverKey(null);
  };
  const endDrag = () => {
    setDragKey(null);
    setOverKey(null);
  };

  const openOnKey = (e: ReactKeyboardEvent<HTMLDivElement>, key: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(key);
    }
  };

  async function startDownload() {
    if (busy || n === 0) return;
    onDownloadChange({ state: "working", done: 0, total: n });
    try {
      const { zip, failed } = await zipPhotosInOrder(
        photos.map((p) => ({ src: p.src, label: p.label, wasNumber: numberOf(p.key) })),
        (done, total) => onDownloadChange({ state: "working", done, total })
      );
      if (failed.length === n) {
        onDownloadChange({
          state: "error",
          message: "None of the photos could be downloaded. Check your connection and try again.",
        });
        return;
      }
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileSlug(villaName)}-photos-in-order.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      onDownloadChange({ state: "done", count: n - failed.length, failed });
    } catch (e: any) {
      onDownloadChange({ state: "error", message: e?.message ?? "The download couldn’t be prepared." });
    }
  }

  const applySuggested = () => {
    if (!suggested || busy) return;
    const inSuggestion = new Set(suggested);
    onReorder([...suggested.filter((k) => keys.includes(k)), ...keys.filter((k) => !inSuggestion.has(k))]);
    clearResult();
    setAnnounce("Photos arranged in the suggested order.");
  };

  return (
    <div className="org" ref={rootRef}>
      <div className="org-bar">
        <span className="hint">
          {busy
            ? "Order locked while the download is prepared"
            : `${n} photo${n === 1 ? "" : "s"} · drag to re-order · the first photo is the cover`}
        </span>
        <div className="org-actions">
          <button type="button" className="ghost org-btn" onClick={applySuggested} disabled={!suggested || busy}>
            Use suggested order
          </button>
          <button
            type="button"
            className="ghost org-btn"
            onClick={() => {
              onReset();
              clearResult();
              setAnnounce("Photos back in the listing’s current order.");
            }}
            disabled={!isCustom || busy}
          >
            Reset to listing order
          </button>
        </div>
      </div>

      <ol className={`org-grid ${busy ? "locked" : ""}`}>
        {photos.map((p, k) => {
          const v = verdictOf(p.key);
          const was = numberOf(p.key);
          const label = p.label?.trim() || "No room label";
          return (
            <li
              key={p.key}
              data-key={p.key}
              className={`org-tile ${dragKey === p.key ? "dragging" : ""} ${
                overKey === p.key && dragKey && dragKey !== p.key ? "over" : ""
              }`}
              draggable={!busy}
              onDragStart={(e) => onDragStart(e, p.key)}
              onDragOver={(e) => onDragOver(e, p.key)}
              onDragLeave={() => setOverKey((o) => (o === p.key ? null : o))}
              onDrop={(e) => onDrop(e, p.key)}
              onDragEnd={endDrag}
            >
              <div
                className="org-img"
                role="button"
                tabIndex={0}
                aria-label={`Photo ${k + 1}: ${label}. Enlarge`}
                onClick={() => onOpen(p.key)}
                onKeyDown={(e) => openOnKey(e, p.key)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt="" loading="lazy" crossOrigin="anonymous" draggable={false} />
              </div>
              <span className="org-pos">{k + 1}</span>
              {k === 0 && <span className="org-cover">Cover</span>}
              {v && (
                <span
                  className={`org-verdict ${v.verdict}`}
                  title={
                    v.verdict === "improve" && v.image.flags.length
                      ? `${VERDICT_TEXT[v.verdict]}: ${v.image.flags.map(shortFlag).join(", ")}`
                      : VERDICT_TEXT[v.verdict]
                  }
                >
                  <i aria-hidden="true" />
                  <span className="sr-only">{VERDICT_TEXT[v.verdict]}</span>
                </span>
              )}
              <div className="org-meta">
                <span className="org-label" title={label}>
                  {label}
                </span>
                {/* Only for photos that actually moved (gallery numbers also count videos). */}
                {listingPosOf(p.key) !== k && <span className="org-was">was #{was}</span>}
              </div>
              {/* aria-disabled (not disabled) so a button that just moved its photo to an end keeps focus. */}
              <div className="org-move">
                <button
                  type="button"
                  data-act="earlier"
                  aria-label={`Move photo ${k + 1} earlier`}
                  aria-disabled={k === 0 || busy}
                  onClick={() => press(p.key, "earlier", k - 1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  data-act="cover"
                  aria-label={`Make photo ${k + 1} the cover`}
                  aria-disabled={k === 0 || busy}
                  onClick={() => press(p.key, "cover", 0)}
                >
                  ★
                </button>
                <button
                  type="button"
                  data-act="later"
                  aria-label={`Move photo ${k + 1} later`}
                  aria-disabled={k === n - 1 || busy}
                  onClick={() => press(p.key, "later", k + 1)}
                >
                  ›
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="org-download">
        <button type="button" onClick={startDownload} disabled={busy || n === 0}>
          {busy ? `Compressing ${dl.done} of ${dl.total}…` : "Download photos in this order"}
        </button>
        <p className="hint">
          A ZIP of JPEGs, each {Math.round(MAX_PHOTO_BYTES / 1000)} KB or less, named 01, 02, 03… in this order, with an
          order.csv for the listing team.
          {videoCount > 0 && ` ${videoCount} video${videoCount === 1 ? " isn’t" : "s aren’t"} included.`}
        </p>
        {busy && (
          <div className="progress" aria-hidden="true">
            <div style={{ width: `${(dl.done / Math.max(1, dl.total)) * 100}%` }} />
          </div>
        )}
        {dl.state === "done" && (
          <p className="org-result" role="status">
            <span className="okt">
              Downloaded {dl.count} photo{dl.count === 1 ? "" : "s"}.
            </span>
            {dl.failed.length > 0 && (
              <span className="badt">
                {" "}
                {dl.failed.length} couldn’t be included and are marked MISSING in order.csv:{" "}
                {dl.failed.slice(0, 3).join(", ")}
                {dl.failed.length > 3 ? "…" : ""}.
              </span>
            )}
          </p>
        )}
        {dl.state === "error" && (
          <p className="org-result badt" role="alert">
            {dl.message}
          </p>
        )}
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
