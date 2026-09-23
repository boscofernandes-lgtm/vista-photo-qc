"use client";

import { useMemo, useRef, useState } from "react";
import { analyzeBatch } from "@/lib/analyze";
import { scoreProperty, DEFAULT_WEIGHTS } from "@/lib/scoring";
import { BRAND_PROFILES, DEFAULT_BRAND } from "@/lib/brands";
import { runAIRubric, AIRubricError } from "@/lib/airubric";
import { gradeColor } from "@/lib/ui";
import { AIRubricResult, ImageInput, PropertyMeta, PropertyScore, SubBrand } from "@/lib/types";

const BRAND_ORDER: SubBrand[] = ["vieda", "villas", "veo", "vaana", "residences", "grams"];

/** Cap analysed photos per property so large galleries still score fast. */
const PHOTO_CAP = 40;

/** AI errors that mean AI can't work for the whole batch (not a per-property blip). */
const AI_FATAL_STATUSES = new Set([501, 401, 402]);

/**
 * Consecutive AI failures (of ANY status) that trip the batch circuit-breaker.
 * A persistently broken/misconfigured AI backend can surface as a
 * retryable-looking status (e.g. /api/airubric returns 502 when no model is
 * usable for the key), which the fixed fatal-status set above can't catch — so
 * a run of failures disables AI for the rest of the batch as a catch-all.
 */
const AI_FAIL_STREAK_LIMIT = 3;

type AiMode = "hybrid" | "full";
/** Off, or an AI rubric depth. */
type AiSetting = "off" | AiMode;

type RowStatus = "pending" | "running" | "done" | "error";

interface BulkRow {
  id: number;
  url: string;
  status: RowStatus;
  /** How far through this property's photos we are, while running. */
  photoDone?: number;
  photoTotal?: number;
  /** True while the AI rubric call for this property is in flight. */
  aiRunning?: boolean;
  /** Set when the AI pass failed for this property (it was scored on CV only). */
  aiError?: string;
  meta?: PropertyMeta;
  score?: PropertyScore;
  error?: string;
}

type SortMode = "input" | "worst" | "best";

/** Evenly sample `arr` down to at most `max` items (keeps coverage representative). */
function evenSample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
}

/** Pull StayVista villa URLs out of a pasted blob (newline / comma / space separated). */
function parseUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of text.split(/[\s,]+/)) {
    const u = tok.trim();
    if (!/^https?:\/\//i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function BulkRunner() {
  const [text, setText] = useState("");
  const [brand, setBrand] = useState<SubBrand>(DEFAULT_BRAND);
  const [aiSetting, setAiSetting] = useState<AiSetting>("off");
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [running, setRunning] = useState(false);
  const [sort, setSort] = useState<SortMode>("input");
  const [notice, setNotice] = useState("");
  /** Batch-level reason AI was switched off mid-run (missing key, no credits…). */
  const [aiDisabled, setAiDisabled] = useState("");
  const cancelRef = useRef(false);

  const profile = BRAND_PROFILES[brand];
  const parsedCount = useMemo(() => parseUrls(text).length, [text]);
  const done = rows.filter((r) => r.status === "done" || r.status === "error").length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;

  const completed = rows.filter((r) => r.status === "done" && r.score);
  const summary = useMemo(() => {
    const scored = completed.map((r) => r.score!);
    const avg = scored.length
      ? Math.round(scored.reduce((a, s) => a + s.total100, 0) / scored.length)
      : 0;
    return {
      avg,
      pass: scored.filter((s) => s.pass).length,
      fail: scored.filter((s) => !s.pass).length,
      aiScored: scored.filter((s) => s.aiAssisted).length,
      errors: rows.filter((r) => r.status === "error").length,
    };
  }, [completed, rows]);

  // Only reorder once the run is finished, so progress reads top-to-bottom live.
  const displayRows = useMemo(() => {
    if (running || sort === "input") return rows;
    const rank = (r: BulkRow) => (r.score ? r.score.total100 : r.status === "error" ? -1 : Infinity);
    const copy = [...rows];
    copy.sort((a, b) => (sort === "worst" ? rank(a) - rank(b) : rank(b) - rank(a)));
    return copy;
  }, [rows, sort, running]);

  function patchRow(id: number, patch: Partial<BulkRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    file.text().then((t) => {
      setText((prev) => (prev.trim() ? prev.trimEnd() + "\n" + t : t));
    });
  }

  async function run() {
    const urls = parseUrls(text);
    if (urls.length === 0) {
      setNotice("Paste at least one StayVista villa URL (one per line).");
      return;
    }
    setNotice("");
    setAiDisabled("");
    setSort("input");
    cancelRef.current = false;
    setRunning(true);
    setRows(urls.map((url, id) => ({ id, url, status: "pending" })));

    // Local mirror of the AI setting: a fatal AI error flips it off for the
    // rest of the batch so we don't fire N doomed calls.
    let aiActive: AiMode | null = aiSetting === "off" ? null : aiSetting;
    let aiFailStreak = 0;

    for (let i = 0; i < urls.length; i++) {
      if (cancelRef.current) break;
      patchRow(i, { status: "running", photoDone: 0, aiRunning: false, aiError: undefined });
      try {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(urls[i])}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Scrape failed (${res.status})`);

        const inputs: ImageInput[] = (data.images ?? []).map((im: any) => ({
          id: im.id,
          src: im.src,
          originalUrl: im.originalUrl,
          label: im.label,
          source: "url" as const,
        }));
        const sampled = evenSample(inputs, PHOTO_CAP);
        if (sampled.length === 0) throw new Error("No readable photos on this listing.");

        const analyses = await analyzeBatch(sampled, (p) =>
          patchRow(i, { photoDone: p.done, photoTotal: p.total })
        );
        if (analyses.length === 0) throw new Error("Could not read any of the photos.");

        // Optional AI rubric pass — one OpenRouter call per property.
        let ai: AIRubricResult | null = null;
        let aiError: string | undefined;
        if (aiActive) {
          patchRow(i, { aiRunning: true });
          try {
            ai = await runAIRubric(analyses, brand, aiActive);
            aiFailStreak = 0;
          } catch (e) {
            const ae = e as AIRubricError;
            aiError = ae?.error ?? "AI scoring failed";
            aiFailStreak++;
            // Stop firing doomed calls for the rest of the batch when AI is
            // clearly broken: an explicit config/credit failure (501/401/402),
            // OR a run of consecutive failures (a persistently misconfigured
            // backend that surfaces as a retryable-looking status). Either way
            // fall back to CV for the remaining properties.
            if (AI_FATAL_STATUSES.has(ae?.status) || aiFailStreak >= AI_FAIL_STREAK_LIMIT) {
              aiActive = null;
              setAiDisabled(aiError);
            }
          } finally {
            patchRow(i, { aiRunning: false });
          }
        }

        const score = scoreProperty(analyses, DEFAULT_WEIGHTS, { brand, ai });
        patchRow(i, { status: "done", meta: data.meta as PropertyMeta, score, aiError });
      } catch (e: any) {
        patchRow(i, { status: "error", error: e?.message ?? "Failed", aiRunning: false });
      }
    }

    setRunning(false);
  }

  function stop() {
    cancelRef.current = true;
  }

  function exportCsv() {
    const header = [
      "URL",
      "Property",
      "City",
      "State",
      "Listing photos",
      "Analyzed",
      "Score /100",
      "Rubric /100",
      "Grade",
      "Brand",
      "Threshold",
      "Result",
      "AI scored",
      "AI note",
      "Reshoot flags",
      "Error",
    ];
    const lines = rows.map((r) => {
      const s = r.score;
      return [
        r.url,
        r.meta?.name ?? "",
        r.meta?.city ?? "",
        r.meta?.state ?? "",
        r.meta?.photosCount ?? "",
        s?.imageCount ?? "",
        s?.total100 ?? "",
        s?.banded100 ?? "",
        s?.grade ?? "",
        profile.name,
        s?.threshold ?? "",
        s ? (s.pass ? "PASS" : "FAIL") : "",
        s?.aiAssisted ? (s.aiSummary ? `yes — ${s.aiSummary}` : "yes") : "no",
        r.aiError ?? "",
        s?.reshootList.length ?? "",
        r.error ?? "",
      ]
        .map(csvCell)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `framecheck-bulk-${brand}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const aiOn = aiSetting !== "off";

  return (
    <div>
      <label className="small">Paste StayVista villa URLs — one per line</label>
      <textarea
        className="bulk-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={running}
        placeholder={
          "https://www.stayvista.com/villa/the-stone-house-in-beze-...\n" +
          "https://www.stayvista.com/villa/...\n" +
          "https://www.stayvista.com/villa/..."
        }
      />

      <div className="row" style={{ gap: 18, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
        <div style={{ minWidth: 230 }}>
          <label className="small">Score against sub-brand</label>
          <select value={brand} onChange={(e) => setBrand(e.target.value as SubBrand)} disabled={running}>
            {BRAND_ORDER.map((b) => (
              <option key={b} value={b}>
                {BRAND_PROFILES[b].name} — {BRAND_PROFILES[b].minScore}+
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="small" id="ai-rubric-label">AI rubric scoring</label>
          <div className="seg" role="group" aria-labelledby="ai-rubric-label">
            {([
              ["off", "Off"],
              ["hybrid", "Hybrid"],
              ["full", "Full"],
            ] as [AiSetting, string][]).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                aria-pressed={aiSetting === val}
                className={`seg-btn ${aiSetting === val ? "active" : ""}`}
                onClick={() => setAiSetting(val)}
                disabled={running}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="small">Or load a .txt / .csv of URLs</label>
          <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(e) => onFile(e.target.files)} disabled={running} />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          {running ? (
            <button type="button" className="ghost" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={run} disabled={parsedCount === 0}>
              {rows.length ? "Re-run QC" : "Run QC"}
              {parsedCount > 0 ? ` · ${parsedCount}` : ""}
            </button>
          )}
        </div>
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        Each listing is scraped, then up to {PHOTO_CAP} photos are scored in your browser against the{" "}
        {profile.name} standard (pass bar {profile.minScore}+). Nothing is uploaded.
        {aiOn && (
          <>
            {" "}
            AI scoring adds one OpenRouter call per property ({aiSetting === "hybrid"
              ? "Cover, Set-ups & Lifestyle"
              : "all six categories"}, ≤8 photos each) — slower and uses credits.
          </>
        )}
      </div>

      {notice && <div className="error" style={{ marginTop: 10 }}>{notice}</div>}

      {aiDisabled && (
        <div className="error" style={{ marginTop: 10 }}>
          AI scoring unavailable — {aiDisabled} Remaining properties were scored on CV only.
          {aiDisabled.toLowerCase().includes("not configured") && (
            <div className="hint" style={{ marginTop: 6 }}>
              Add <code>OPENAI_API_KEY</code> (or <code>OPENROUTER_API_KEY</code>) in your Vercel project
              settings → Environment Variables, then redeploy.
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          {(running || done > 0) && (
            <div style={{ marginTop: 18 }}>
              <div className="progress">
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="hint">
                {running ? `Scoring ${done} / ${rows.length} properties…` : `Done — ${done} / ${rows.length} properties`}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div className="bulk-summary" style={{ marginTop: 18 }}>
              <div className="bulk-stat">
                <div className="n">{summary.avg}</div>
                <div className="l">Avg score /100</div>
              </div>
              <div className="bulk-stat">
                <div className="n" style={{ color: "var(--good)" }}>{summary.pass}</div>
                <div className="l">Pass {profile.minScore}+</div>
              </div>
              <div className="bulk-stat">
                <div className="n" style={{ color: "var(--bad)" }}>{summary.fail}</div>
                <div className="l">Below bar</div>
              </div>
              {summary.aiScored > 0 && (
                <div className="bulk-stat">
                  <div className="n" style={{ color: "var(--gold-2)" }}>{summary.aiScored}</div>
                  <div className="l">AI scored</div>
                </div>
              )}
              {summary.errors > 0 && (
                <div className="bulk-stat">
                  <div className="n bulk-muted">{summary.errors}</div>
                  <div className="l">Failed to load</div>
                </div>
              )}
            </div>
          )}

          <div className="toolbar" style={{ margin: "18px 0 10px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="small" style={{ margin: 0 }} id="bulk-sort-label">Sort</span>
              <div className="seg" role="group" aria-labelledby="bulk-sort-label">
                {(["input", "worst", "best"] as SortMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={sort === m}
                    className={`seg-btn ${sort === m ? "active" : ""}`}
                    onClick={() => setSort(m)}
                    disabled={running}
                  >
                    {m === "input" ? "Order" : m === "worst" ? "Worst first" : "Best first"}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="ghost" onClick={exportCsv} disabled={completed.length === 0}>
              Export CSV
            </button>
          </div>

          <div className="bulk-wrap card pad">
            <table className="bulk-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Property</th>
                  <th style={{ textAlign: "center" }}>Photos</th>
                  <th style={{ textAlign: "center" }}>Score</th>
                  <th>Grade</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r, i) => {
                  const s = r.score;
                  const color = s ? gradeColor(s.grade) : "var(--muted)";
                  return (
                    <tr key={r.id} className={`bulk-row ${r.status === "error" ? "err" : ""}`}>
                      <td className="bulk-muted">{i + 1}</td>
                      <td>
                        {r.meta?.name ? (
                          <>
                            <div className="bulk-prop-name">{r.meta.name}</div>
                            <div className="bulk-prop-loc">
                              {[r.meta.city, r.meta.state].filter(Boolean).join(", ")}
                            </div>
                          </>
                        ) : (
                          <a className="bulk-prop-link" href={r.url} target="_blank" rel="noreferrer">
                            {r.url.replace(/^https?:\/\/(www\.)?stayvista\.com\/villa\//, "").slice(0, 60) || r.url}
                          </a>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {s ? (
                          <>
                            {s.imageCount}
                            {r.meta?.photosCount ? <span className="bulk-muted"> / {r.meta.photosCount}</span> : ""}
                          </>
                        ) : (
                          <span className="bulk-muted">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {s ? (
                          <span className="bulk-score" style={{ color }}>{s.total100}</span>
                        ) : (
                          <span className="bulk-muted">—</span>
                        )}
                      </td>
                      <td>
                        {s ? (
                          <span className="grade-pill" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
                            {s.grade}
                          </span>
                        ) : (
                          <span className="bulk-muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.status === "done" && s ? (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <span className={`pass-pill ${s.pass ? "pass" : "fail"}`}>
                              {s.pass ? `Pass ${s.threshold}+` : `Below ${s.threshold}+`}
                            </span>
                            {s.aiAssisted && <span className="ai-badge">AI</span>}
                            {r.aiError && <span className="bulk-muted" title={r.aiError}>CV only</span>}
                          </span>
                        ) : r.status === "running" ? (
                          <span className="bulk-spin">
                            {r.aiRunning
                              ? "AI scoring…"
                              : `Analyzing${r.photoTotal ? ` ${r.photoDone}/${r.photoTotal}` : "…"}`}
                          </span>
                        ) : r.status === "error" ? (
                          <span className="bulk-err-text">{r.error}</span>
                        ) : (
                          <span className="bulk-muted">Queued</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
