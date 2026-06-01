"use client";

import { ImageAnalysis, PropertyMeta, SubScore, Weights } from "@/lib/types";
import { scoreProperty } from "@/lib/scoring";
import { gradeColor, score01Color } from "@/lib/ui";
import ImageCard from "./ImageCard";

function Sub({ s }: { s: SubScore }) {
  const pct = s.max > 0 ? s.points / s.max : 0;
  return (
    <div className="sub">
      <div className="line">
        <span>{s.label}</span>
        <span>
          {s.points.toFixed(1)} / {s.max}
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
}: {
  meta: PropertyMeta;
  analyses: ImageAnalysis[];
  weights: Weights;
}) {
  const result = scoreProperty(analyses, weights);
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
            <div style={{ marginTop: 12 }}>
              <span
                className="grade-pill"
                style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
              >
                {result.grade}
              </span>
            </div>
            <div className="solution">
              <strong>Recommended action:</strong> {result.solution}
            </div>
            <div className="hint">
              Raw rubric score: {result.total30.toFixed(1)} pts · Shots{" "}
              {result.shotsPillar.toFixed(1)} · Quality {result.qualityPillar.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

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
