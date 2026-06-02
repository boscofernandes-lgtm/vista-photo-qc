"use client";

import { Weights } from "@/lib/types";
import { DEFAULT_WEIGHTS } from "@/lib/scoring";

interface Props {
  weights: Weights;
  onChange: (w: Weights) => void;
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="weight">
      <label className="small">
        {label} — <span className="wv">{value}</span>
      </label>
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function WeightsPanel({ weights, onChange }: Props) {
  const set = (path: (w: Weights) => void) => {
    const next: Weights = JSON.parse(JSON.stringify(weights));
    path(next);
    onChange(next);
  };

  const total =
    weights.shots.cover +
    weights.shots.setups +
    weights.shots.lifestyle +
    weights.quality.lighting +
    weights.quality.angles +
    weights.quality.edits;

  return (
    <div className="card pad">
      <div className="toolbar" style={{ margin: "0 0 14px" }}>
        <strong>Scoring weights</strong>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="hint" style={{ margin: 0 }}>Max points: {total}</span>
          <button
            className="ghost"
            onClick={() => onChange(JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)) as Weights)}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="section-title" style={{ margin: "0 0 10px" }}>Shots</div>
      <div className="weights">
        <WeightSlider label="Cover & Facade" value={weights.shots.cover} onChange={(v) => set((w) => (w.shots.cover = v))} />
        <WeightSlider label="Set ups (Food & Interiors)" value={weights.shots.setups} onChange={(v) => set((w) => (w.shots.setups = v))} />
        <WeightSlider label="Lifestyle" value={weights.shots.lifestyle} onChange={(v) => set((w) => (w.shots.lifestyle = v))} />
      </div>

      <div className="section-title" style={{ margin: "16px 0 10px" }}>Photography Quality</div>
      <div className="weights">
        <WeightSlider label="Lighting" value={weights.quality.lighting} onChange={(v) => set((w) => (w.quality.lighting = v))} />
        <WeightSlider label="Angles & Frames" value={weights.quality.angles} onChange={(v) => set((w) => (w.quality.angles = v))} />
        <WeightSlider label="Edits" value={weights.quality.edits} onChange={(v) => set((w) => (w.quality.edits = v))} />
      </div>
    </div>
  );
}
