"use client";

import { FormEvent, ReactNode, useMemo, useRef, useState } from "react";
import { SubBrand, Weights } from "@/lib/types";
import { VistaProperty, toMeta } from "@/lib/vistaApi";
import { GalleryPhoto, galleryFromProperty, inputsFromGallery } from "@/lib/gallery";
import { VillaEntry, VillaSummary } from "./VillaCard";
import Workspace from "./Workspace";
import { useVillaChecks } from "./useVillaChecks";

type SearchState = "idle" | "indexing" | "searching" | "done" | "error";

/** Photos checked per villa, sampled across the gallery so big galleries stay quick. */
const PHOTO_SAMPLE = 40;

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

  // ---- Galleries ----
  const [props, setProps] = useState<Record<number, VistaProperty>>({});
  const [galleryErr, setGalleryErr] = useState(false);
  /** Villas whose full gallery couldn't be loaded; their cards show the cover photo only. */
  const [galleryFailed, setGalleryFailed] = useState<Set<number>>(() => new Set());
  const propsRef = useRef(props);
  propsRef.current = props;

  const galleries = useMemo(() => {
    const m: Record<number, GalleryPhoto[]> = {};
    for (const p of Object.values(props)) m[p.id] = galleryFromProperty(p);
    return m;
  }, [props]);

  const ws = useVillaChecks({
    brand,
    weights,
    prepare: async (key) => {
      const id = Number(key);
      let p = propsRef.current[id];
      if (!p) {
        const res = await fetch(`/api/properties?id=${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn’t load this villa.");
        const loaded = data.property as VistaProperty;
        setProps((m) => ({ ...m, [id]: loaded }));
        p = loaded;
      }
      return { inputs: inputsFromGallery(galleryFromProperty(p), "url", PHOTO_SAMPLE), meta: toMeta(p) };
    },
  });

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
        list.map((r) => r.id).filter((id): id is number => id != null),
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

  const entryFor = (id: number, summary?: VillaSummary): VillaEntry | undefined => {
    const p = props[id];
    const s = summary ?? (p ? summaryFromProperty(p) : undefined);
    if (!s) return undefined;
    return {
      key: String(id),
      summary: s,
      photos: galleries[id] ?? null,
      galleryFailed: galleryFailed.has(id),
      sourceUrl: p?.slug ? `https://www.stayvista.com/villa/${p.slug}` : undefined,
    };
  };
  const entries = results
    .map((r) => (r.id != null ? entryFor(r.id, r) : undefined))
    .filter((e): e is VillaEntry => e !== undefined);
  const lookup = (key: string) => entries.find((e) => e.key === key) ?? entryFor(Number(key));

  // Results are only replaced when a search succeeds, so keep showing them (and
  // any open report) while a new search runs or after one finds nothing.
  const showResults = results.length > 0 || ws.selectedKey != null;

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
        <Workspace
          entries={entries}
          lookup={lookup}
          ws={ws}
          brand={brand}
          onBrandChange={onBrandChange}
          weights={weights}
          onWeightsChange={onWeightsChange}
          aiMode={aiMode}
          onAIModeChange={onAIModeChange}
          emptyText={
            <>
              Press <b>Analyze villa</b> on any card. Its full report appears in this panel and stays in view while you
              scroll the villas.
            </>
          }
          bar={
            results.length > 0 && (
              <p className="browse-bar">
                <b>{total.toLocaleString()}</b> match{total === 1 ? "" : "es"} for “{lastQuery}”
                {total > results.length ? ` · showing the first ${results.length}` : ""} · searched{" "}
                {indexed.toLocaleString()} properties
                {galleryErr && (
                  <span className="browse-warn"> · Couldn’t load the full galleries, so some cards show the cover photo only.</span>
                )}
              </p>
            )
          }
        />
      )}
    </>
  );
}
