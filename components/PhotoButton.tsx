"use client";

/**
 * A report photo. With `onClick` it becomes a button that opens the photo
 * viewer; without one it's a plain image. `crossOrigin` matches how the
 * analyser loaded the same URL, so the browser can reuse the cached copy.
 */
export default function PhotoButton({
  src,
  alt,
  lazy,
  className,
  onClick,
}: {
  src: string;
  alt: string;
  lazy?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={lazy ? "lazy" : undefined} crossOrigin="anonymous" className={className} />
  );
  if (!onClick) return img;
  return (
    <button type="button" className="photo-btn" onClick={onClick} aria-label={`Enlarge photo: ${alt}`}>
      {img}
    </button>
  );
}
