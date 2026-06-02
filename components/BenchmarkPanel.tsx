"use client";

import { PropertyScore, SubBrand } from "@/lib/types";
import { COMPETITORS, brandProfile } from "@/lib/brands";

/** Average a competitor's five 1–5 category scores onto the /100 scale. */
function comp100(c: { cover: number; setups: number; lifestyle: number; lighting: number; angles: number }): number {
  return Math.round(((c.cover + c.setups + c.lifestyle + c.lighting + c.angles) / 25) * 100);
}

const CATS: { key: keyof typeof COMPETITORS[number]; label: string }[] = [
  { key: "cover", label: "Cover" },
  { key: "setups", label: "Setups" },
  { key: "lifestyle", label: "Lifestyle" },
  { key: "lighting", label: "Lighting" },
  { key: "angles", label: "Angles" },
];

export default function BenchmarkPanel({ result, brand }: { result: PropertyScore; brand: SubBrand }) {
  const profile = brandProfile(brand);
  // This property's 1–5 bands keyed by category for the comparison row.
  const band = (k: string) => result.subScores.find((s) => s.key === k)?.band ?? 1;
  const thisRow = {
    cover: band("cover"),
    setups: band("setups"),
    lifestyle: band("lifestyle"),
    lighting: band("lighting"),
    angles: band("angles"),
  };

  // Rank all brands (competitors + this property) by /100 to show positioning.
  const rows = [
    ...COMPETITORS.map((c) => ({ brand: c.brand, tier: c.tier, scores: c, score100: comp100(c), isThis: false, isBenchmark: c.isBenchmark })),
    { brand: `This property (${profile.name})`, tier: "Your score", scores: thisRow, score100: result.banded100, isThis: true, isBenchmark: false },
  ].sort((a, b) => b.score100 - a.score100);

  return (
    <div className="card pad">
      <div className="toolbar" style={{ margin: "0 0 6px" }}>
        <strong>Competitor benchmark</strong>
        <span className="hint" style={{ margin: 0 }}>
          Target: {profile.comparableTo} · Benchmark: Lohono Stays
        </span>
      </div>
      <div className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        Where this property sits against the observable photography standard of each brand (1–5 per category).
      </div>

      <div className="bench-table">
        <div className="bench-row bench-head">
          <span className="bench-brand">Brand</span>
          {CATS.map((c) => (
            <span key={c.key} className="bench-cell">{c.label}</span>
          ))}
          <span className="bench-cell bench-total">/100</span>
        </div>
        {rows.map((r) => (
          <div key={r.brand} className={`bench-row ${r.isThis ? "is-this" : ""} ${r.isBenchmark ? "is-bench" : ""}`}>
            <span className="bench-brand">
              {r.brand}
              {r.isBenchmark && <span className="bench-tag">★</span>}
              <span className="bench-tier">{r.tier}</span>
            </span>
            {CATS.map((c) => {
              const v = (r.scores as Record<string, number>)[c.key];
              return (
                <span key={c.key} className="bench-cell">
                  <span className={`bench-dot d${v}`}>{v}</span>
                </span>
              );
            })}
            <span className="bench-cell bench-total">{r.score100}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
