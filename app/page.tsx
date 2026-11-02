"use client";

import { useState } from "react";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";
import { DEFAULT_BRAND } from "@/lib/brands";
import { SubBrand, Weights } from "@/lib/types";
import BrowseView from "@/components/BrowseView";
import UrlView from "@/components/UrlView";
import UploadView from "@/components/UploadView";
import BulkView from "@/components/BulkView";

type Mode = "browse" | "url" | "upload" | "bulk";

const MODES: { id: Mode; label: string }[] = [
  { id: "browse", label: "Browse StayVista" },
  { id: "url", label: "From StayVista URL" },
  { id: "upload", label: "Upload photos" },
  { id: "bulk", label: "Bulk QC" },
];

export default function Home() {
  const [mode, setMode] = useState<Mode>("browse");
  // Scoring settings are shared by every tab, so a villa scores the same wherever it's opened.
  const [weights, setWeights] = useState<Weights>(() => JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)));
  const [brand, setBrand] = useState<SubBrand>(DEFAULT_BRAND);
  const [aiMode, setAiMode] = useState<"hybrid" | "full">("hybrid");

  const tabs = (
    <div className="tabs" role="tablist" aria-label="How to find photos">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={`tab ${mode === m.id ? "active" : ""}`}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  // Every tab uses the same cards + report-panel layout. Tabs stay mounted while
  // hidden, so finished checks and photo arrangements aren't lost on switching.
  const shared = {
    tabs,
    brand,
    onBrandChange: setBrand,
    weights,
    onWeightsChange: setWeights,
    aiMode,
    onAIModeChange: setAiMode,
  };

  return (
    <div className="container wide">
      <div className="topbar">
        <div className="brand">
          <div className="dot" />
          <h1>StayVista FrameCheck</h1>
        </div>
        <div className="cobrand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/stayvista-logo.png" alt="StayVista" className="cobrand-logo" />
        </div>
      </div>
      <p className="subtitle">
        Automated hospitality photography quality control — scores any property against the StayVista rubric, fully in
        your browser.
      </p>

      <div hidden={mode !== "browse"}>
        <BrowseView {...shared} />
      </div>
      <div hidden={mode !== "url"}>
        <UrlView {...shared} />
      </div>
      <div hidden={mode !== "upload"}>
        <UploadView {...shared} />
      </div>
      <div hidden={mode !== "bulk"}>
        <BulkView {...shared} />
      </div>
    </div>
  );
}
