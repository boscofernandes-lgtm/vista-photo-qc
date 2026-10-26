"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { analyzeBatch } from "@/lib/analyze";
import { scoreProperty } from "@/lib/scoring";
import { recommend } from "@/lib/recommend";
import { AIRubricResult, PhotoVerdict, PropertyScore, Recommendations, SubBrand, Weights } from "@/lib/types";
import { VistaProperty, toImageInputs, toMeta } from "@/lib/vistaApi";
import VillaCard, { VillaRun, VillaSummary, slidesFor } from "./VillaCard";
import ReportPanel from "./ReportPanel";
import PhotoViewer, { ViewerItem } from "./PhotoViewer";

type SearchState = "idle" | "indexing" | "searching" | "done" | "error";

/** Photos checked per villa, sampled across the gallery so big galleries stay quick. */
const PHOTO_SAMPLE = 40;

/** Below this width the report opens as a full-screen overlay instead of a side panel (see globals.css). */
const isNarrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches;

/** A search result rebuilt from a full property, for villas no longer in the results. */
function summaryFromProperty(p: VistaProperty): VillaSummary {
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    state: p.state,
    propertyType: p.propertyType,
    rooms: p.rooms,
    maxOccupancy: p.maxOccupancy,
    photosCount: p.photosCount,
    videoCount: p.videoCount,
    thumbnail: p.thumbnail,
  };
}

/**
 * Browse StayVista: search the catalog, flip through each villa's gallery on a
 * stayvista.com-style card, check villas one at a time, and read the full QC
 * report in a panel that stays beside the cards.
 */
export default function BrowseView({
  tabs,
  brand,
  onBrandChange,
  weights,
  onWeightsChange,
  aiMode,
  onAIModeChange,
}: {
  /** The page's mode tabs, shown at the top of the search card. */
  tabs: ReactNode;
  brand: SubBrand;
  onBrandChange: (b: SubBrand) => void;
  weights: Weights;
  onWeightsChange: (w: Weights) => void;
  aiMode: "hybrid" | "full";
  onAIModeChange: (m: "hybrid" | "full") => void;
}) {
  // ---- Search ----
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>("idle");
  const [err, setErr] = useState("");
  const [results, setResults] = useState<VillaSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [indexed, setIndexed] = useState(0);
  const [lastQuery, setLastQuery] = useState("");
  const searchSeq = useRef(0);

  // ---- Galleries, checks, selection ----
  const [props, setProps] = useState<Record<number, VistaProperty>>({});
  const [galleryErr, setGalleryErr] = useState(false);
  /** Villas whose full gallery couldn't be loaded; their cards show the cover photo only. */
  const [galleryFailed, setGalleryFailed] = useState<Set<number>>(() => new Set());
  const [runs, setRuns] = useState<Record<number, VillaRun>>({});
  const [queue, setQueue] = useState<number[]>([]);
  const [slideIdx, setSlideIdx] = useState<Record<number, number>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{ villaId: number; index: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; villaId: number } | null>(null);

  const propsRef = useRef(props);
  propsRef.current = props;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const running = useRef(false);

  async function doSearch(e?: FormEvent) {
    e?.preventDefault();
    const query = q.trim();
    if (!query) {
      setState("idle");
      return;
    }
    const seq = ++searchSeq.current;
    // The first search may build the server-side index (one-time, a few seconds).
    setState(indexed ? "searching" : "indexing");
    setErr("");
    try {
      const res = await fetch(`/api/properties?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      if (seq !== searchSeq.current) return;
      const list: VillaSummary[] = data.results ?? [];
      setResults(list);
      setTotal(data.total ?? 0);
      setIndexed(data.indexed ?? 0);
      setLastQuery(query);
      setState("done");
      void loadGalleries(
        list.map((r) => r.id),
        seq
      );
    } catch (e: any) {
      if (seq !== searchSeq.current) return;
      setErr(e?.message ?? "Search failed");
      setState("error");
    }
  }

  /** One request for every card's full gallery (cards show their cover photo until then). */
  async function loadGalleries(ids: number[], seq: number) {
    const missing = ids.filter((id) => !propsRef.current[id]);
    setGalleryErr(false);
    if (missing.length === 0) return;
    const markFailed = (failed: number[]) => {
      if (failed.length === 0) return;
      setGalleryFailed((s) => new Set([...Array.from(s), ...failed]));
      if (seq === searchSeq.current) setGalleryErr(true);
    };
    try {
      const res = await fetch(`/api/properties?ids=${missing.join(",")}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gallery load failed");
      const got: VistaProperty[] = data.properties ?? [];
      setProps((m) => {
        const next = { ...m };
        for (const p of got) next[p.id] = p;
        return next;
      });
      markFailed(missing.filter((id) => !got.some((p) => p.id === id)));
    } catch {
      markFailed(missing);
    }
  }

  // ---- The check queue: one villa at a time, so each finishes quickly ----
  function analyze(id: number) {
    setRuns((r) => ({ ...r, [id]: { status: "queued" } }));
    setQueue((qq) => (qq.includes(id) ? qq : [...qq, id]));
    // On wide screens, show "Checking <villa>…" in the side panel straight away,
    // unless a report is open there. On phones/tablets the report is a
    // full-screen overlay, so don't cover the page: the card shows progress and
    // a toast offers the report when it's ready.
    const sel = selectedRef.current;
    if (!isNarrow() && (sel === null || sel === id || runsRef.current[sel]?.status === "error")) setSelectedId(id);
  }

  useEffect(() => {
    if (running.current || queue.length === 0) return;
    const id = queue[0];
    running.current = true;
    void runCheck(id).finally(() => {
      running.current = false;
      setQueue((qq) => qq.filter((x) => x !== id));
    });
    // runCheck only touches setters and refs, so it can't go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  async function runCheck(id: number) {
    setRuns((r) => ({ ...r, [id]: { status: "running", done: 0, total: 0 } }));
    try {
      let p: VistaProperty | undefined = propsRef.current[id];
      if (!p) {
        const res = await fetch(`/api/properties?id=${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn’t load this villa.");
        const loaded = data.property as VistaProperty;
        setProps((m) => ({ ...m, [id]: loaded }));
        p = loaded;
      }
      const villa = p;
      const inputs = toImageInputs(villa, PHOTO_SAMPLE);
      if (inputs.length === 0) throw new Error("This listing has no photos to check.");
      setRuns((r) => ({ ...r, [id]: { status: "running", done: 0, total: inputs.length } }));
      const analyses = await analyzeBatch(inputs, (pr) =>
        setRuns((r) => ({ ...r, [id]: { status: "running", done: pr.done, total: pr.total } }))
      );
      if (analyses.length === 0) throw new Error("None of the photos could be read.");
      setRuns((r) => ({ ...r, [id]: { status: "done", analyses, meta: toMeta(villa), ai: null } }));
      // If the panel is already waiting on this villa, its report simply appears.
      // Otherwise offer it in a toast: never swap out a report that's being read,
      // and never reopen a panel the user closed.
      const sel = selectedRef.current;
      if (sel !== id) {
        if (sel !== null && runsRef.current[sel]?.status === "error") setSelectedId(id);
        else setToast({ text: `${villa.name} is checked.`, villaId: id });
      }
    } catch (e: any) {
      setRuns((r) => ({ ...r, [id]: { status: "error", error: e?.message ?? "Something went wrong." } }));
    }
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Scores follow the shared sub-brand / weights, so cards and panel agree ----
  const scored = useMemo(() => {
    const m: Record<number, { score: PropertyScore; rec: Recommendations }> = {};
    for (const [k, run] of Object.entries(runs)) {
      if (run.status === "done") {
        m[Number(k)] = {
          score: scoreProperty(run.analyses, weights, { brand, ai: run.ai }),
          rec: recommend(run.analyses),
        };
      }
    }
    return m;
  }, [runs, weights, brand]);

  const summaryOf = (id: number): VillaSummary | null =>
    results.find((r) => r.id === id) ?? (props[id] ? summaryFromProperty(props[id]) : null);

  // AI scores are judged against one sub-brand, so a new sub-brand clears them
  // all, whichever tab it was changed from (the sub-brand is shared).
  useEffect(() => {
    setRuns((r) => {
      let changed = false;
      const next = { ...r };
      for (const k of Object.keys(next)) {
        const run = next[Number(k)];
        if (run.status === "done" && run.ai) {
          next[Number(k)] = { ...run, ai: null };
          changed = true;
        }
      }
      return changed ? next : r;
    });
  }, [brand]);

  // Escape closes the full-screen report on phones/tablets (the photo viewer
  // handles its own Escape while it's open).
  useEffect(() => {
    if (selectedId === null || viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isNarrow()) setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, viewer]);

  function setAI(id: number, ai: AIRubricResult | null) {
    setRuns((r) => {
      const run = r[id];
      return run && run.status === "done" ? { ...r, [id]: { ...run, ai } } : r;
    });
  }

  function showPhoto(villaId: number, index: number) {
    setSlideIdx((m) => ({ ...m, [villaId]: index }));
    setViewer({ villaId, index });
  }

  // ---- Photo viewer: the villa's whole gallery, with QC results where there are any ----
  function viewerItems(villaId: number): ViewerItem[] {
    const villa = summaryOf(villaId);
    if (!villa) return [];
    const slides = slidesFor(villa, props[villaId]?.photos ?? null);
    const run = runs[villaId];
    const rec = scored[villaId]?.rec;
    const byIndex = new Map<number, PhotoVerdict>();
    for (const v of rec?.verdicts ?? []) {
      if (v.image.input.listingIndex != null) byIndex.set(v.image.input.listingIndex, v);
    }
    const heroIndex = rec?.hero?.image.input.listingIndex;
    const checked = run?.status === "done" ? run.analyses.length : 0;
    return slides.map((s, k) => {
      const v = byIndex.get(k);
      return {
        key: s.key,
        kind: s.kind,
        src: s.src,
        label: s.kind === "video" ? "Video" : s.tag,
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

  const selectedRun = selectedId != null ? runs[selectedId] : undefined;
  const selectedSummary = selectedId != null ? summaryOf(selectedId) : null;
  const viewerList = viewer ? viewerItems(viewer.villaId) : [];
  // Results are only replaced when a search succeeds, so keep showing them (and
  // any open report) while a new search runs or after one finds nothing.
  const showResults = results.length > 0 || selectedId != null;

  const closePanel = (
    <button type="button" className="ghost rp-close rp-empty-close" aria-label="Close" onClick={() => setSelectedId(null)}>
      ✕
    </button>
  );

  let panel: ReactNode;
  if (selectedId != null && selectedRun?.status === "done") {
    const id = selectedId;
    panel = (
      <ReportPanel
        key={id}
        villaId={id}
        meta={selectedRun.meta}
        analyses={selectedRun.analyses}
        weights={weights}
        brand={brand}
        ai={selectedRun.ai}
        aiMode={aiMode}
        onBrandChange={onBrandChange}
        onAIModeChange={onAIModeChange}
        onAIResult={(r) => setAI(id, r)}
        onWeightsChange={onWeightsChange}
        onClose={() => setSelectedId(null)}
        onPhotoClick={(a) => {
          if (a.input.listingIndex != null) showPhoto(id, a.input.listingIndex);
        }}
      />
    );
  } else if (selectedId != null && (selectedRun?.status === "running" || selectedRun?.status === "queued")) {
    panel = (
      <div className="rp-empty">
        {closePanel}
        <span className="spin" aria-hidden="true" />
        <h3>Checking {selectedSummary?.name ?? "this villa"}…</h3>
        <p>
          {selectedRun.status === "running" && selectedRun.total > 0
            ? `${selectedRun.done} of ${selectedRun.total} photos checked. `
            : "Waiting for the villa ahead of it to finish. "}
          The report opens here as soon as the check is done.
        </p>
      </div>
    );
  } else if (selectedId != null && selectedRun?.status === "error") {
    const id = selectedId;
    panel = (
      <div className="rp-empty">
        {closePanel}
        <h3>Couldn’t check {selectedSummary?.name ?? "this villa"}</h3>
        <p>{selectedRun.error}</p>
        <button type="button" onClick={() => analyze(id)}>
          Try again
        </button>
      </div>
    );
  } else {
    panel = (
      <div className="rp-empty">
        <h3>Reports open here</h3>
        <p>
          Press <b>Analyze villa</b> on any card. Its full report appears in this panel and stays in view while you
          scroll the villas.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card pad">
        {tabs}
        <form className="row" style={{ alignItems: "flex-end" }} onSubmit={doSearch}>
          <div className="grow">
            <label className="small" htmlFor="browse-q">
              Search StayVista properties
            </label>
            <input
              id="browse-q"
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by villa name, city, state, or property ID — e.g. Goa, Lonavala, 5638…"
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" disabled={state === "indexing" || state === "searching" || !q.trim()}>
              {state === "indexing" ? "Indexing…" : state === "searching" ? "Searching…" : "Search"}
            </button>
          </div>
        </form>

        {state === "indexing" && (
          <div className="hint" style={{ marginTop: 12 }}>
            Indexing the StayVista catalog — one-time, takes a few seconds. Later searches are instant.
          </div>
        )}
        {state === "error" && (
          <div className="error" style={{ marginTop: 12 }}>
            {err}
            {err.toLowerCase().includes("not configured") && (
              <div className="hint" style={{ marginTop: 6 }}>
                Add <code>VISTA_API_KEY</code> and <code>VISTA_SECRET_KEY</code> in your Vercel project settings →
                Environment Variables, then redeploy.
              </div>
            )}
          </div>
        )}
        {state === "done" && results.length === 0 && (
          <div className="hint" style={{ marginTop: 12 }}>
            No properties match “{lastQuery}”. Try a city or part of the villa name.
          </div>
        )}
        {state === "idle" && (
          <div className="hint" style={{ marginTop: 12 }}>
            Type a city or villa name and press Search. Flip through each villa’s photos, then press{" "}
            <b>Analyze villa</b> to check it.
          </div>
        )}
      </div>

      {showResults && (
        <div className={`browse ${selectedId != null ? "has-report" : ""}`}>
          <div className="browse-main">
            <p className="browse-bar">
              <b>{total.toLocaleString()}</b> match{total === 1 ? "" : "es"} for “{lastQuery}”
              {total > results.length ? ` · showing the first ${results.length}` : ""} · searched{" "}
              {indexed.toLocaleString()} properties
              {galleryErr && (
                <span className="browse-warn"> · Couldn’t load the full galleries, so cards show the cover photo only.</span>
              )}
            </p>
            <div className="villa-grid">
              {results.map((v) => {
                const run = runs[v.id];
                const qPos = queue.indexOf(v.id);
                return (
                  <VillaCard
                    key={v.id}
                    villa={v}
                    photos={props[v.id]?.photos ?? null}
                    galleryFailed={galleryFailed.has(v.id)}
                    run={run}
                    score={scored[v.id]?.score ?? null}
                    rec={scored[v.id]?.rec ?? null}
                    selected={selectedId === v.id}
                    index={slideIdx[v.id] ?? 0}
                    queueAhead={qPos > 0 ? qPos : 0}
                    onStep={(d, count) =>
                      setSlideIdx((m) => {
                        const cur = Math.min(m[v.id] ?? 0, count - 1);
                        return { ...m, [v.id]: (cur + d + count) % count };
                      })
                    }
                    onAnalyze={() => analyze(v.id)}
                    onShowReport={() => setSelectedId(v.id)}
                    onOpenPhoto={(i) => showPhoto(v.id, i)}
                  />
                );
              })}
            </div>
          </div>
          <aside className={`report-panel ${selectedId != null ? "open" : ""}`} aria-label="QC report">
            {panel}
          </aside>
        </div>
      )}

      {viewer && viewerList.length > 0 && (
        <PhotoViewer
          title={summaryOf(viewer.villaId)?.name ?? "Photos"}
          items={viewerList}
          index={viewer.index}
          onIndexChange={(i) => showPhoto(viewer.villaId, i)}
          onClose={() => setViewer(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setSelectedId(toast.villaId);
              setToast(null);
            }}
          >
            See report
          </button>
        </div>
      )}
    </>
  );
}
