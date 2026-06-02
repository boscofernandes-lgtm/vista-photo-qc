"use client";

import { AIRubricResult, ImageAnalysis, PropertyMeta, SubBrand, SubScore, Weights } from "@/lib/types";
import { scoreProperty } from "@/lib/scoring";
import { gradeColor, score01Color } from "@/lib/ui";
import ImageCard from "./ImageCard";
import Recommendations from "./Recommendations";
import FixDownload from "./FixDownload";
import BenchmarkPanel from "./BenchmarkPanel";

function Sub({ s }: { s: SubScore }) {
  const pct = s.max > 0 ? s.points / s.max : 0;
  return (
    <div className="sub">
      <div className="line">
        <span>
          {s.label}
          <span className={`src-tag ${s.source}`}>{s.source === "ai" ? "AI" : "CV"}</span>
        </span>
        <span>
          <span className={`band b${s.band}`}>{s.band}/5</span>
          <span className="pts">{s.points.toFixed(1)} / {s.max}</span>
        </span>
      </div>
      <div className="bar">
        <div style={{ width: `${pct * 100}%`, background: score01Color(pct) }} />
      </div>
      <div className="detail">{s.detail}</div>
    </div>
  );
}

export default function ScoreReport({
  meta,
  analyses,
  weights,
  brand,
  ai,
}: {
  meta: PropertyMeta;
  analyses: ImageAnalysis[];
  weights: Weights;
  brand: SubBrand;
  ai: AIRubricResult | null;
}) {
  const result = scoreProperty(analyses, weights, { brand, ai });
  const color = gradeColor(result.grade);
  const shotsSubs = result.subScores.filter((s) =>
    ["cover", "setups", "lifestyle"].includes(s.key)
  );
  const qualitySubs = result.subScores.filter((s) =>
    ["lighting", "angles", "edits"].includes(s.key)
  );

  return (
    <div>
      <div className="card pad">
        <div className="hero">
          <div
            className="gauge"
            style={{
              background: `conic-gradient(${color} ${result.total100 * 3.6}deg, var(--panel-2) 0deg)`,
            }}
          >
            <div className="inner">
              <div>
                <div className="score" style={{ color }}>{result.total100}</div>
                <div className="outof">/ 100</div>
              </div>
            </div>
          </div>
          <div>
            <h2 className="meta-name">{meta.name}</h2>
            <div className="meta-sub">
              {[meta.city, meta.state].filter(Boolean).join(", ")}
              {meta.photosCount ? ` · ${meta.photosCount} photos on listing` : ""}
              {` · ${result.imageCount} analyzed`}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span
                className="grade-pill"
                style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
              >
                {result.grade}
              </span>
              <span className={`pass-pill ${result.pass ? "pass" : "fail"}`}>
                {result.pass ? `Passes ${result.threshold}+ bar` : `Below ${result.threshold}+ bar`}
              </span>
              {result.aiAssisted && <span className="ai-badge">AI-assisted</span>}
            </div>
            <div className="solution">
              <strong>Recommended action:</strong> {result.solution}
            </div>
            <div className="scale-row">
              <div className="scale-box">
                <div className="scale-num">{result.banded100}</div>
                <div className="scale-lbl">Rubric scorecard /100 (1–5 bands)</div>
              </div>
              <div className="scale-box">
                <div className="scale-num">{result.total30.toFixed(1)}</div>
                <div className="scale-lbl">Raw points / 30</div>
              </div>
            </div>
            <div className="hint">
              Shots {result.shotsPillar.toFixed(1)} · Quality {result.qualityPillar.toFixed(1)}
              {result.aiSummary ? ` · ${result.aiSummary}` : ""}
            </div>
          </div>
        </div>
      </div>

      <BenchmarkPanel result={result} brand={brand} />

      <Recommendations analyses={analyses} />

      <div className="section-title">Score breakdown</div>
      <div className="pillars">
        <div className="card pad pillar">
          <h3>Shots</h3>
          {shotsSubs.map((s) => (
            <Sub key={s.key} s={s} />
          ))}
        </div>
        <div className="card pad pillar">
          <h3>Photography Quality</h3>
          {qualitySubs.map((s) => (
            <Sub key={s.key} s={s} />
          ))}
        </div>
      </div>

      {result.reshootList.length > 0 && (
        <>
          <div className="section-title">Reshoot / fix list ({result.reshootList.length})</div>
          <div className="card pad">
            {result.reshootList.map((r) => (
              <div className="reshoot-item" key={r.image.input.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.image.input.src} alt="" />
                <div>
                  <div style={{ fontSize: 13 }}>{r.image.input.label ?? "Photo"}</div>
                  <div className="why">{r.reasons.join(" · ")}</div>
                  <FixDownload a={r.image} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">All photos ({analyses.length})</div>
      <div className="grid">
        {analyses.map((a) => (
          <ImageCard key={a.input.id} a={a} />
        ))}
      </div>
    </div>
  );
}
