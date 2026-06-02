"use client";

import { ImageAnalysis } from "@/lib/types";
import { recommend } from "@/lib/recommend";

export default function Recommendations({ analyses }: { analyses: ImageAnalysis[] }) {
  const rec = recommend(analyses);
  if (!rec.hero) return null;

  const total = analyses.length;
  const { hero } = rec;

  return (
    <div>
      <div className="section-title">Recommendations</div>

      <div className="card pad reco">
        {/* Cover / hero pick */}
        <div className="reco-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hero.image.input.src} alt={hero.image.input.label ?? "cover"} />
          <div className="reco-hero-body">
            <div className="reco-kicker">Recommended cover photo</div>
            <div className="reco-hero-title">
              {hero.image.input.label ?? "Photo"}
            </div>
            <p className="reco-reason">{hero.reason}</p>
            {hero.isCurrentCover ? (
              <span className="reco-pill good">✓ Already your cover — keep it</span>
            ) : (
              <span className="reco-pill warn">
                Currently photo #{hero.currentIndex + 1} — move it to the front
              </span>
            )}
          </div>
        </div>

        {/* Suggested running order */}
        <div className="reco-block">
          <div className="reco-block-head">
            <strong>Suggested running order</strong>
            <span className={`reco-pill ${rec.reorderNeeded ? "warn" : "good"}`}>
              {rec.reorderNeeded ? "Re-ordering suggested" : "Your order looks good"}
            </span>
          </div>
          <div className="reco-strip">
            {rec.order.map((o) => {
              const moved = o.currentIndex !== o.suggestedIndex;
              return (
                <div className="reco-shot" key={o.image.input.id}>
                  <span className="reco-rank">{o.suggestedIndex + 1}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.image.input.src} alt={o.image.input.label ?? "photo"} loading="lazy" />
                  {moved && <span className="reco-moved">was #{o.currentIndex + 1}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Health summary */}
        <div className="reco-summary">
          {rec.improveCount === 0 ? (
            <span className="good">
              ✓ All {total} photos are listing-ready.
            </span>
          ) : (
            <span className="warn">
              {rec.strongCount} of {total} photos are strong · {rec.improveCount} need attention
              {" "}(see the fix list below).
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
