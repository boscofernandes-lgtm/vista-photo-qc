"use client";

import { ReactNode, useRef, useState } from "react";
import { PropertyMeta, SubBrand, Weights } from "@/lib/types";
import { galleryFromFiles, inputsFromGallery } from "@/lib/gallery";
import { VillaEntry } from "./VillaCard";
import Workspace from "./Workspace";
import { useVillaChecks } from "./useVillaChecks";

const IMAGE_FILE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;

/**
 * Upload photos: each set of photos you pick becomes a card with a carousel (in
 * the order picked), is checked straight away, and gets a full report in the
 * side panel, where it can be re-arranged and downloaded for the listing team.
 */
export default function UploadView({
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
  const [entries, setEntries] = useState<VillaEntry[]>([]);
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
      if (!entry?.photos) throw new Error("Pick the photos again.");
      return { inputs: inputsFromGallery(entry.photos, "upload"), meta: metas.current[key] ?? { name: entry.summary.name } };
    },
  });

  function onPick(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || IMAGE_FILE.test(f.name));
    if (files.length === 0) {
      setErr("Pick one or more photos (JPEG, PNG or WebP).");
      return;
    }
    setErr("");
    const n = ++count.current;
    const key = `upload-${n}`;
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const name = files.length === 1 ? files[0].name : `Uploaded photos · ${time}`;
    const gallery = galleryFromFiles(files, key);
    metas.current[key] = { name, photosCount: files.length };
    setEntries((list) => [
      { key, summary: { name, photosCount: files.length, thumbnail: gallery[0].src }, photos: gallery },
      ...list,
    ]);
    ws.analyze(key);
  }

  return (
    <>
      <div className="card pad">
        {tabs}
        <label className="small" htmlFor="photo-files">
          Select property photos
        </label>
        <input
          id="photo-files"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            onPick(e.target.files);
            e.target.value = ""; // so picking the same files again still works
          }}
        />
        <div className="hint" style={{ marginTop: 12 }}>
          Photos are scored in your browser — nothing is uploaded. Pick them in the order they’re listed; you can
          re-arrange them in the report and download them sized for the website.
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
