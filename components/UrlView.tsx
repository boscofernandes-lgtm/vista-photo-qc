"use client";

import { FormEvent, ReactNode, useRef, useState } from "react";
import { PropertyMeta, SubBrand, Weights } from "@/lib/types";
import { ScrapedPhoto, galleryFromScrape, inputsFromGallery } from "@/lib/gallery";
import { VillaEntry } from "./VillaCard";
import Workspace from "./Workspace";
import { useVillaChecks } from "./useVillaChecks";

const EXAMPLE_URL =
  "https://www.stayvista.com/villa/the-stone-house-in-beze-2-bhk-villa-in-nashik-with-spacious-rooms";

/**
 * From StayVista URL: paste a villa page, see it as a card with its whole
 * gallery in listing order, and get its full report in the side panel. Every
 * photo on the listing is checked. Each URL you check stays as its own card.
 */
export default function UrlView({
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
  const [url, setUrl] = useState(EXAMPLE_URL);
  const [entries, setEntries] = useState<VillaEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const metas = useRef<Record<string, PropertyMeta>>({});
  const count = useRef(0);

  const ws = useVillaChecks({
    brand,
    weights,
    prepare: async (key) => {
      const entry = entriesRef.current.find((e) => e.key === key);
      if (!entry?.photos) throw new Error("Load the listing again.");
      return { inputs: inputsFromGallery(entry.photos, "url"), meta: metas.current[key] ?? { name: entry.summary.name } };
    },
  });

  async function onAnalyze(e?: FormEvent) {
    e?.preventDefault();
    const target = url.trim();
    if (!target) return;
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`/api/scrape?url=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn’t read that page.");
      const meta = data.meta as PropertyMeta;
      // One card per listing: checking the same URL again replaces its card.
      const key = meta.sourceUrl ?? target;
      const existing = entriesRef.current.find((x) => x.key === key);
      const prefix = existing?.photos?.[0]?.key.replace(/-\d+$/, "") ?? `url${++count.current}`;
      const scraped: ScrapedPhoto[] =
        data.gallery ??
        (data.images ?? []).map((im: any) => ({ src: im.src, originalUrl: im.originalUrl, label: im.label, kind: "image" }));
      const gallery = galleryFromScrape(scraped, prefix);
      const stills = gallery.filter((g) => g.kind === "image");
      metas.current[key] = meta;
      const entry: VillaEntry = {
        key,
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
      };
      setEntries((list) => [entry, ...list.filter((x) => x.key !== key)]);
      ws.setOrder(key, null);
      ws.analyze(key);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="card pad">
        {tabs}
        <form className="row" onSubmit={onAnalyze}>
          <div className="grow">
            <label className="small" htmlFor="villa-url">
              StayVista villa URL
            </label>
            <input
              id="villa-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.stayvista.com/villa/..."
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button type="submit" disabled={loading || !url.trim()}>
              {loading ? "Loading…" : "Analyze"}
            </button>
          </div>
        </form>
        <div className="hint" style={{ marginTop: 12 }}>
          Every photo on the listing is checked in your browser — nothing is uploaded.
        </div>
        {err && <div className="error">{err}</div>}
      </div>

      {(entries.length > 0 || ws.selectedKey != null) && (
        <Workspace
          entries={entries}
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
              Press <b>See report</b> on a card to open its report here.
            </>
          }
        />
      )}
    </>
  );
}
