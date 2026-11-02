"use client";

import { ReactNode, useMemo, useRef, useState } from "react";
import { BRAND_PROFILES } from "@/lib/brands";
import { runAIRubric, AIRubricError } from "@/lib/airubric";
import { PropertyMeta, SubBrand, Weights } from "@/lib/types";
import { ScrapedPhoto, galleryFromScrape, inputsFromGallery } from "@/lib/gallery";
import { VillaEntry } from "./VillaCard";
import Workspace from "./Workspace";
import { useVillaChecks } from "./useVillaChecks";

const BRAND_ORDER: SubBrand[] = ["vieda", "villas", "veo", "vaana", "residences", "grams"];

/** Cap analysed photos per property so large galleries still score fast (same sample as Browse). */
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
type SortMode = "input" | "worst" | "best";

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

/** A readable name from a villa URL, shown until the page has loaded. */
function nameFromUrl(url: string): string {
  let text = url;
  try {
    const u = new URL(url);
    const villa = u.pathname.match(/^\/villa\/([^/]+)/);
    text = villa ? decodeURIComponent(villa[1]).replace(/[-_]+/g, " ") : `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    // not a URL: show it as typed
  }
  text = text.trim() || url;
  return text.length > 60 ? text.slice(0, 57) + "…" : text;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Bulk QC: paste many villa URLs and check them one after another. Each villa
 * gets a carousel card and a full report in the side panel; the batch summary,
 * sorting and CSV export work across all of them.
 */
export default function BulkView({
  tabs,
  brand,
  onBrandChange,
  weights,
  onWeightsChange,
  aiMode,
  onAIModeChange,
}: {
  tabs: ReactNode;
  brand: SubBrand;
  onBrandChange: (b: SubBrand) => void;
  weights: Weights;
  onWeightsChange: (w: Weights) => void;
  aiMode: "hybrid" | "full";
  onAIModeChange: (m: "hybrid" | "full") => void;
}) {
  const [text, setText] = useState("");
  const [aiSetting, setAiSetting] = useState<AiSetting>("off");
  const [entries, setEntries] = useState<VillaEntry[]>([]);
  const [sort, setSort] = useState<SortMode>("input");
  const [notice, setNotice] = useState("");
  /** Batch-level reason AI was switched off mid-run (missing key, no credits…). */
  const [aiDisabled, setAiDisabled] = useState("");

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const metas = useRef<Record<string, PropertyMeta>>({});
  const brandRef = useRef(brand);
  brandRef.current = brand;
  // The AI setting for the running batch: a fatal error or a failure streak
  // switches it off for the rest of the batch so we don't fire N doomed calls.
  const aiActive = useRef<AiMode | null>(null);
  const aiFailStreak = useRef(0);
  const batch = useRef(0);

  const ws = useVillaChecks({
    brand,
    weights,
    // The batch progress bar and summary report progress; no toast per villa.
    notify: false,
    prepare: async (key) => {
      const res = await fetch(`/api/scrape?url=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Couldn’t read the page (${res.status}).`);
      const meta = data.meta as PropertyMeta;
      const scraped: ScrapedPhoto[] =
        data.gallery ??
        (data.images ?? []).map((im: any) => ({ src: im.src, originalUrl: im.originalUrl, label: im.label, kind: "image" }));
      const prefix = `b${batch.current}-${entriesRef.current.findIndex((e) => e.key === key)}`;
      const gallery = galleryFromScrape(scraped, prefix);
      const stills = gallery.filter((g) => g.kind === "image");
      metas.current[key] = meta;
      setEntries((list) =>
        list.map((e) =>
          e.key === key
            ? {
                ...e,
                summary: {
                  name: meta.name,
                  city: meta.city,
                  state: meta.state,
                  photosCount: stills.length,
                  videoCount: gallery.length - stills.length,
                  thumbnail: stills[0]?.src,
                },
                photos: gallery,
                sourceUrl: meta.sourceUrl,
              }
            : e
        )
      );
      return { inputs: inputsFromGallery(gallery, "url", PHOTO_CAP), meta };
    },
    // No AI pass (null) when AI is off or was switched off for this batch.
    afterAnalyze: (_key, analyses) => {
      const mode = aiActive.current;
      if (!mode) return null;
      const brandAsked = brandRef.current;
      return (async () => {
        try {
          const ai = await runAIRubric(analyses, brandAsked, mode);
          aiFailStreak.current = 0;
          return { ai };
        } catch (e) {
          const ae = e as AIRubricError;
          const aiError = ae?.error ?? "AI scoring failed";
          aiFailStreak.current++;
          if (AI_FATAL_STATUSES.has(ae?.status) || aiFailStreak.current >= AI_FAIL_STREAK_LIMIT) {
            aiActive.current = null;
            setAiDisabled(aiError);
          }
          return { ai: null, aiError };
        }
      })();
    },
  });

  const profile = BRAND_PROFILES[brand];
  const parsedCount = useMemo(() => parseUrls(text).length, [text]);
  const statusOf = (key: string) => ws.runs[key]?.status;
  const running = entries.some((e) => statusOf(e.key) === "queued" || statusOf(e.key) === "running");
  const finished = entries.filter((e) => statusOf(e.key) === "done" || statusOf(e.key) === "error").length;
  const pct = entries.length ? Math.round((finished / entries.length) * 100) : 0;

  const summary = useMemo(() => {
    const scores = entries.map((e) => ws.scored[e.key]?.score).filter((s): s is NonNullable<typeof s> => !!s);
    return {
      count: scores.length,
      avg: scores.length ? Math.round(scores.reduce((a, s) => a + s.total100, 0) / scores.length) : 0,
      pass: scores.filter((s) => s.pass).length,
      fail: scores.filter((s) => !s.pass).length,
      aiScored: scores.filter((s) => s.aiAssisted).length,
      errors: entries.filter((e) => statusOf(e.key) === "error").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, ws.scored, ws.runs]);

  // Only reorder once the batch is finished, so progress reads top-to-bottom live.
  const displayed = useMemo(() => {
    if (running || sort === "input") return entries;
    const rank = (e: VillaEntry) => {
      const s = ws.scored[e.key]?.score;
      return s ? s.total100 : statusOf(e.key) === "error" ? -1 : Infinity;
    };
    const copy = [...entries];
    copy.sort((a, b) => (sort === "worst" ? rank(a) - rank(b) : rank(b) - rank(a)));
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sort, running, ws.scored]);

  function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    file.text().then((t) => {
      setText((prev) => (prev.trim() ? prev.trimEnd() + "\n" + t : t));
    });
  }

  function run() {
    const urls = parseUrls(text);
    if (urls.length === 0) {
      setNotice("Paste at least one StayVista villa URL (one per line).");
      return;
    }
    setNotice("");
    setAiDisabled("");
    setSort("input");
    aiActive.current = aiSetting === "off" ? null : aiSetting;
    aiFailStreak.current = 0;
    batch.current++;
    // A new batch replaces the previous one.
    ws.forget(entriesRef.current.map((e) => e.key));
    setEntries(urls.map((url) => ({ key: url, summary: { name: nameFromUrl(url), photosCount: 0 }, photos: null })));
    for (const url of urls) {
      ws.setOrder(url, null);
      ws.analyze(url);
    }
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
    const lines = entries.map((e) => {
      const run = ws.runs[e.key];
      const s = ws.scored[e.key]?.score;
      const meta = metas.current[e.key];
      return [
        e.key,
        meta?.name ?? "",
        meta?.city ?? "",
        meta?.state ?? "",
        meta?.photosCount ?? "",
        s?.imageCount ?? "",
        s?.total100 ?? "",
        s?.banded100 ?? "",
        s?.grade ?? "",
        profile.name,
        s?.threshold ?? "",
        s ? (s.pass ? "PASS" : "FAIL") : "",
        s?.aiAssisted ? (s.aiSummary ? `yes — ${s.aiSummary}` : "yes") : "no",
        run?.status === "done" ? run.aiError ?? "" : "",
        s?.reshootList.length ?? "",
        run?.status === "error" ? run.error : "",
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
    <>
      <div className="card pad">
        {tabs}
        <label className="small" htmlFor="bulk-urls">
          Paste StayVista villa URLs — one per line
        </label>
        <textarea
          id="bulk-urls"
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
            <label className="small" htmlFor="bulk-brand">
              Score against sub-brand
            </label>
            <select
              id="bulk-brand"
              value={brand}
              onChange={(e) => onBrandChange(e.target.value as SubBrand)}
              disabled={running}
            >
              {BRAND_ORDER.map((b) => (
                <option key={b} value={b}>
                  {BRAND_PROFILES[b].name} — {BRAND_PROFILES[b].minScore}+
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="small" id="ai-rubric-label">
              AI rubric scoring
            </label>
            <div className="seg" role="group" aria-labelledby="ai-rubric-label">
              {(
                [
                  ["off", "Off"],
                  ["hybrid", "Hybrid"],
                  ["full", "Full"],
                ] as [AiSetting, string][]
              ).map(([val, lbl]) => (
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
            <label className="small" htmlFor="bulk-file">
              Or load a .txt / .csv of URLs
            </label>
            <input
              id="bulk-file"
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              onChange={(e) => onFile(e.target.files)}
              disabled={running}
            />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            {running ? (
              <button type="button" className="ghost" onClick={ws.cancelQueued}>
                Stop
              </button>
            ) : (
              <button type="button" onClick={run} disabled={parsedCount === 0}>
                {entries.length ? "Re-run QC" : "Run QC"}
                {parsedCount > 0 ? ` · ${parsedCount}` : ""}
              </button>
            )}
          </div>
        </div>

        <div className="hint" style={{ marginTop: 10 }}>
          Each listing is loaded, then up to {PHOTO_CAP} photos are scored in your browser against the {profile.name}{" "}
          standard (pass bar {profile.minScore}+). Nothing is uploaded.
          {aiOn && (
            <>
              {" "}
              AI scoring adds one OpenRouter call per property (
              {aiSetting === "hybrid" ? "Cover, Set-ups & Lifestyle" : "all six categories"}, ≤8 photos each) — slower and
              uses credits.
            </>
          )}
        </div>

        {notice && (
          <div className="error" style={{ marginTop: 10 }}>
            {notice}
          </div>
        )}

        {aiDisabled && (
          <div className="error" style={{ marginTop: 10 }}>
            AI scoring unavailable — {aiDisabled} Remaining properties were scored on CV only.
            {aiDisabled.toLowerCase().includes("not configured") && (
              <div className="hint" style={{ marginTop: 6 }}>
                Add <code>OPENAI_API_KEY</code> (or <code>OPENROUTER_API_KEY</code>) in your Vercel project settings →
                Environment Variables, then redeploy.
              </div>
            )}
          </div>
        )}
      </div>

      {(entries.length > 0 || ws.selectedKey != null) && (
        <Workspace
          entries={displayed}
          lookup={(key) => entries.find((e) => e.key === key)}
          ws={ws}
          brand={brand}
          onBrandChange={onBrandChange}
          weights={weights}
          onWeightsChange={onWeightsChange}
          aiMode={aiMode}
          onAIModeChange={onAIModeChange}
          emptyText={
            <>
              Press <b>See report</b> on any villa to open its full report here.
            </>
          }
          bar={
            entries.length > 0 && (
              <div className="bulk-head">
                <div className="progress" aria-hidden="true">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  {running
                    ? `Scoring ${finished} / ${entries.length} properties…`
                    : `Done — ${finished} / ${entries.length} properties`}
                </p>

                {summary.count > 0 && (
                  <div className="bulk-summary" style={{ marginTop: 14 }}>
                    <div className="bulk-stat">
                      <div className="n">{summary.avg}</div>
                      <div className="l">Avg score /100</div>
                    </div>
                    <div className="bulk-stat">
                      <div className="n" style={{ color: "var(--good)" }}>
                        {summary.pass}
                      </div>
                      <div className="l">Pass {profile.minScore}+</div>
                    </div>
                    <div className="bulk-stat">
                      <div className="n" style={{ color: "var(--bad)" }}>
                        {summary.fail}
                      </div>
                      <div className="l">Below bar</div>
                    </div>
                    {summary.aiScored > 0 && (
                      <div className="bulk-stat">
                        <div className="n" style={{ color: "var(--gold-2)" }}>
                          {summary.aiScored}
                        </div>
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

                <div className="toolbar" style={{ margin: "14px 0 14px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="small" style={{ margin: 0 }} id="bulk-sort-label">
                      Sort
                    </span>
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
                  <button type="button" className="ghost" onClick={exportCsv} disabled={summary.count === 0}>
                    Export CSV
                  </button>
                </div>
              </div>
            )
          }
        />
      )}
    </>
  );
}
