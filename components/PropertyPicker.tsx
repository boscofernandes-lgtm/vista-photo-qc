"use client";

import { useEffect, useState } from "react";
import { VistaProperty, VistaPagination } from "@/lib/vistaApi";

type LoadState = "idle" | "loading" | "done" | "error";

export default function PropertyPicker({
  onSelect,
  busy,
}: {
  onSelect: (p: VistaProperty) => void;
  busy: boolean;
}) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>("idle");
  const [err, setErr] = useState("");
  const [properties, setProperties] = useState<VistaProperty[]>([]);
  const [pagination, setPagination] = useState<VistaPagination | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState("loading");
      setErr("");
      try {
        const res = await fetch(`/api/properties?page=${page}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load properties");
        if (cancelled) return;
        setProperties(data.properties ?? []);
        setPagination(data.pagination ?? null);
        setState("done");
      } catch (e: any) {
        if (cancelled) return;
        setErr(e.message ?? "Failed to load properties");
        setState("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? properties.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.city ?? "").toLowerCase().includes(q) ||
          (p.state ?? "").toLowerCase().includes(q)
      )
    : properties;

  const totalPages = pagination?.total_pages ?? 1;

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="grow">
          <label className="small">Filter this page (by name or location)</label>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="e.g. Goa, Lonavala, villa name…"
          />
        </div>
        {pagination && (
          <span className="hint" style={{ margin: 0, whiteSpace: "nowrap" }}>
            {pagination.total.toLocaleString()} properties · page {pagination.current_page} / {totalPages}
          </span>
        )}
      </div>

      {state === "loading" && (
        <div className="hint" style={{ marginTop: 14 }}>Loading properties from the StayVista API…</div>
      )}
      {state === "error" && (
        <div className="error" style={{ marginTop: 14 }}>
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
          <div className="picker-grid">
            {shown.map((p) => (
              <button
                key={p.id}
                className="picker-card"
                onClick={() => onSelect(p)}
                disabled={busy || p.photosCount === 0}
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
                </div>
                <div className="picker-body">
                  <div className="picker-name">{p.name}</div>
                  <div className="picker-loc">
                    {[p.city, p.state].filter(Boolean).join(", ") || p.propertyType || "—"}
                  </div>
                </div>
              </button>
            ))}
            {shown.length === 0 && (
              <div className="hint">No properties match “{filter}” on this page.</div>
            )}
          </div>

          <div className="picker-pager">
            <button
              className="ghost"
              onClick={() => setPage((n) => Math.max(1, n - 1))}
              disabled={page <= 1 || busy}
            >
              ← Prev
            </button>
            <span className="hint" style={{ margin: 0 }}>
              Page {page} / {totalPages}
            </span>
            <button
              className="ghost"
              onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
              disabled={page >= totalPages || busy}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
