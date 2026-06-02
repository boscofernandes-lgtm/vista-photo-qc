"use client";

import { useState } from "react";
import { ImageAnalysis } from "@/lib/types";
import { correctImage, isCorrectable, reshootOnlyReasons } from "@/lib/correct";

type State = "idle" | "working" | "done" | "error";

export default function FixDownload({ a }: { a: ImageAnalysis }) {
  const [state, setState] = useState<State>("idle");
  const [url, setUrl] = useState<string>("");
  const [applied, setApplied] = useState<string[]>([]);
  const [err, setErr] = useState<string>("");

  const reshootOnly = reshootOnlyReasons(a.cv);
  const correctable = isCorrectable(a.cv);

  function slug() {
    const base = (a.input.label ?? "photo").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return `framecheck-${base || "photo"}.jpg`;
  }

  async function onCorrect() {
    setState("working");
    setErr("");
    try {
      const res = await correctImage(a.input.src, a.cv);
      setUrl(res.url);
      setApplied(res.applied);
      setState("done");
      // Trigger download.
      const link = document.createElement("a");
      link.href = res.url;
      link.download = slug();
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Correction failed");
      setState("error");
    }
  }

  return (
    <div className="fix">
      {reshootOnly.length > 0 && (
        <div className="fix-reshoot">
          Reshoot only — {reshootOnly.join("; ")}.
        </div>
      )}

      {correctable ? (
        <>
          <button className="fix-btn" onClick={onCorrect} disabled={state === "working"}>
            {state === "working"
              ? "Correcting…"
              : state === "done"
              ? "Download again"
              : "Correct & download"}
          </button>
          {state === "done" && (
            <div className="fix-done">
              <div className="fix-applied">
                {applied.map((x, i) => (
                  <span className="fix-chip" key={i}>
                    {x}
                  </span>
                ))}
              </div>
              {url && (
                <div className="fix-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.input.src} alt="before" />
                  <span className="fix-arrow">→</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="after" />
                </div>
              )}
              <div className="fix-note">
                Faithful edit — exposure, white balance, contrast &amp; saturation only. No content
                added or removed.
              </div>
            </div>
          )}
          {state === "error" && <div className="fix-err">{err}</div>}
        </>
      ) : reshootOnly.length === 0 ? (
        <div className="fix-ok">Quality is acceptable — no faithful correction needed.</div>
      ) : null}
    </div>
  );
}
