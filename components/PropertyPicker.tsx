"use client";

import { FormEvent, useState } from "react";
import { VistaProperty } from "@/lib/vistaApi";

interface SlimProperty {
  id: number;
  name: string;
  city?: string;
  state?: string;
  propertyType?: string;
  photosCount: number;
  thumbnail?: string;
}

type State = "idle" | "indexing" | "searching" | "done" | "error";

export default function PropertyPicker({
  onSelect,
  busy,
}: {
  onSelect: (p: VistaProperty) => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>("idle");
  const [err, setErr] = useState("");
  const [results, setResults] = useState<SlimProperty[]>([]);
  const [total, setTotal] = useState(0);
  const [indexed, setIndexed] = useState(0);
  const [selectingId, setSelectingId] = useState<number | null>(null);

  async function doSearch(e?: FormEvent) {
    e?.preventDefault();
    const query = q.trim();
    if (!query) {
      setResults([]);
      setState("idle");
      return;
    }
    // First search may build the server-side index (one-time, a few seconds).
    setState(indexed ? "searching" : "indexing");
    setErr("");
    try {
      const res = await fetch(`/api/properties?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results ?? []);
      setTotal(data.total ?? 0);
      setIndexed(data.indexed ?? 0);
      setState("done");
    } catch (e: any) {
      setErr(e.message ?? "Search failed");
      setState("error");
    }
  }

  async function pick(id: number) {
    if (busy || selectingId) return;
    setSelectingId(id);
    setErr("");
    try {
      const res = await fetch(`/api/properties?id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load property");
      await onSelect(data.property as VistaProperty);
    } catch (e: any) {
      setErr(e.message ?? "Could not load property");
      setState("error");
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div>
      <form className="row" style={{ alignItems: "flex-end" }} onSubmit={doSearch}>
        <div className="grow">
          <label className="small">Search StayVista properties</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by villa name, city or state — e.g. Goa, Lonavala, Mulberry…"
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
              Add <code>VISTA_API_KEY</code> and <code>VISTA_SECRET_KEY</code> in your Vercel project
              settings → Environment Variables, then redeploy.
            </div>
          )}
        </div>
      )}

      {state === "done" && (
        <>
          <div className="hint" style={{ marginTop: 12 }}>
            {total > 0
              ? `${total.toLocaleString()} match${total === 1 ? "" : "es"}${
                  total > results.length ? ` · showing first ${results.length}` : ""
                } · searched ${indexed.toLocaleString()} properties`
              : `No properties match “${q.trim()}”. Try a city or part of the villa name.`}
          </div>

          {results.length > 0 && (
            <div className="picker-grid">
              {results.map((p) => (
                <button
                  key={p.id}
                  className="picker-card"
                  onClick={() => pick(p.id)}
                  disabled={busy || p.photosCount === 0 || selectingId !== null}
                  title={p.photosCount === 0 ? "No photos available" : `Analyze ${p.name}`}
                >
                  <div className="picker-thumb">
                    {p.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnail} alt="" loading="lazy" />
                    ) : (
                      <div className="picker-noimg">No photo</div>
                    )}
                    <span className="picker-count">{p.photosCount} 📷</span>
                    {selectingId === p.id && <span className="picker-loading">Loading…</span>}
                  </div>
                  <div className="picker-body">
                    <div className="picker-name">{p.name}</div>
                    <div className="picker-loc">
                      {[p.city, p.state].filter(Boolean).join(", ") || p.propertyType || "—"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {state === "idle" && (
        <div className="hint" style={{ marginTop: 12 }}>
          Type a city or villa name and hit Search to pull live listings from the StayVista API.
        </div>
      )}
    </div>
  );
}
