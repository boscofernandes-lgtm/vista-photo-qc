"use client";

import { ImageAnalysis } from "@/lib/types";
import { CATEGORY_LABEL, score01Color } from "@/lib/ui";
import PhotoButton from "./PhotoButton";

function Mini({ label, v }: { label: string; v: number }) {
  return (
    <div className="mini">
      <b style={{ color: score01Color(v) }}>{Math.round(v * 100)}</b>
      {label}
    </div>
  );
}

export default function ImageCard({ a, onOpen }: { a: ImageAnalysis; onOpen?: () => void }) {
  const cat = a.uncertain ? "Uncertain" : CATEGORY_LABEL[a.clip.top];
  return (
    <div className="card imgcard">
      <PhotoButton className="thumb" src={a.input.src} alt={a.input.label ?? "photo"} lazy onClick={onOpen} />
      <div className="body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span className="badge">{cat}</span>
          {a.input.label && <span className="badge">{a.input.label}</span>}
          {a.input.listingIndex != null && <span className="badge num">#{a.input.listingIndex + 1}</span>}
        </div>
        <div className="minis">
          <Mini label="Light" v={a.scores.lighting} />
          <Mini label="Angle" v={a.scores.angles} />
          <Mini label="Edit" v={a.scores.edits} />
        </div>
        {a.flags.length > 0 && (
          <div className="flags">
            {a.flags.map((f) => (
              <span className="flag" key={f}>{f}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
