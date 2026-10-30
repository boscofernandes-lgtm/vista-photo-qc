"use client";

import { useEffect, useState } from "react";
import { GalleryPhoto } from "@/lib/gallery";

const HeartIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.4 3.4 5 6.8 5c2 0 3.5 1.1 4.2 2.6h2c.7-1.5 2.2-2.6 4.2-2.6 3.4 0 5.2 3.4 4.1 6.3-1.8 4.6-9.3 9.2-9.3 9.2Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"
    />
  </svg>
);

/**
 * How the villa's card looks on a StayVista city page (e.g. "Villas in
 * Lonavala"), built from the photos in their arranged order: the first photo is
 * the cover, and the carousel follows the order below it.
 */
export default function CityPageView({
  photos,
  name,
  location,
  guests,
  rooms,
  sourceUrl,
  numberOf,
  onOpen,
}: {
  /** Still photos in the arranged order. */
  photos: GalleryPhoto[];
  name: string;
  location?: string;
  guests?: number;
  rooms?: number;
  sourceUrl?: string;
  /** 1-based gallery number of a photo, as it is on the listing today. */
  numberOf: (key: string) => number;
  onOpen: (key: string) => void;
}) {
  const [i, setI] = useState(0);
  const n = photos.length;
  const idx = n ? Math.min(i, n - 1) : 0;
  const photo = photos[idx];
  const coverKey = photos[0]?.key;

  // A new cover (re-ordered gallery) should be what the preview shows first.
  useEffect(() => setI(0), [coverKey]);

  const go = (d: number) => setI((cur) => (Math.min(cur, n - 1) + d + n) % n);
  const facts = [guests ? `Upto ${guests} Guests` : null, rooms ? `${rooms} Rooms` : null].filter(
    (x): x is string => x !== null
  );

  return (
    <div className="cpv">
      <div className="cpv-page">
        <div className="cpv-card">
          <div className="cpv-img">
            {photo ? (
              <button
                type="button"
                className="photo-btn"
                onClick={() => onOpen(photo.key)}
                aria-label={`Enlarge photo ${idx + 1} of ${n}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.src} alt={photo.label ?? `Photo ${idx + 1}`} crossOrigin="anonymous" />
              </button>
            ) : (
              <div className="cpv-noimg">No photos</div>
            )}
            <span className="cpv-heart" aria-hidden="true">
              <HeartIcon />
            </span>
            {idx === 0 && n > 0 && <span className="cpv-cover">Cover</span>}
            {n > 1 && (
              <>
                <button type="button" className="cpv-nav prev" aria-label="Previous photo" onClick={() => go(-1)}>
                  ‹
                </button>
                <button type="button" className="cpv-nav next" aria-label="Next photo" onClick={() => go(1)}>
                  ›
                </button>
                <span className="cpv-count">
                  {idx + 1} / {n}
                </span>
              </>
            )}
          </div>
          <div className="cpv-body">
            <div className="cpv-name">{name}</div>
            {location && (
              <div className="cpv-loc">
                <PinIcon />
                {location}
              </div>
            )}
            {facts.length > 0 && (
              <div className="cpv-facts">
                {facts.map((f, k) => (
                  <span key={f}>
                    {k > 0 && <i aria-hidden="true">✦</i>}
                    {f}
                  </span>
                ))}
              </div>
            )}
            <div className="cpv-foot">
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  View on stayvista.com <span aria-hidden="true">→</span>
                </a>
              ) : (
                <span>Preview of the city-page card</span>
              )}
            </div>
          </div>
        </div>
      </div>
      {photos[0] && (
        <p className="hint cpv-note">
          Cover: <b>{photos[0].label?.trim() || "photo"}</b> (photo #{numberOf(photos[0].key)} on the listing today).
          Drag any photo to the first tile below to change it.
        </p>
      )}
    </div>
  );
}
