"use client";

import { ImageAnalysis } from "@/lib/types";
import { recommend } from "@/lib/recommend";
import PhotoButton from "./PhotoButton";

/** 1-based gallery number: the real listing position when the gallery was sampled. */
const photoNo = (a: ImageAnalysis, analysedIndex: number) => (a.input.listingIndex ?? analysedIndex) + 1;

export default function Recommendations({
  analyses,
  onPhotoClick,
}: {
  analyses: ImageAnalysis[];
  /** Opens a photo in the photo viewer. */
  onPhotoClick?: (a: ImageAnalysis) => void;
}) {
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
          <PhotoButton
            src={hero.image.input.src}
            alt={hero.image.input.label ?? "cover"}
            onClick={onPhotoClick ? () => onPhotoClick(hero.image) : undefined}
          />
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
                Currently photo #{photoNo(hero.image, hero.currentIndex)} — move it to the front
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
              // Compare the photo's real gallery number with its suggested slot, so a
              // sampled gallery neither hides real moves nor shows "3 · was #3".
              const was = photoNo(o.image, o.currentIndex);
              const moved = was !== o.suggestedIndex + 1;
              return (
                <div className="reco-shot" key={o.image.input.id}>
                  <span className="reco-rank">{o.suggestedIndex + 1}</span>
                  <PhotoButton
                    src={o.image.input.src}
                    alt={o.image.input.label ?? "photo"}
                    lazy
                    onClick={onPhotoClick ? () => onPhotoClick(o.image) : undefined}
                  />
                  {moved && <span className="reco-moved">was #{was}</span>}
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
              {" "}(see the fix list).
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
