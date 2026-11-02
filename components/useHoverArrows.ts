"use client";

import { useEffect, useRef } from "react";

/** Elements that use the arrow keys themselves (typing, sliders, the panel resizer…). */
const OWNS_ARROWS =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=slider], [role=separator], [role=listbox], [role=menu]";

type Stepper = { step: (delta: 1 | -1) => void; el: Element | null };

/** The carousel under the mouse right now, if any. One key listener serves them all. */
let hovered: Stepper | null = null;
let installed = false;

function onKey(e: KeyboardEvent) {
  if (!hovered || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
  // Changing the photo swaps the image under the pointer, and then the browser
  // can skip the "mouse left" event; ask it whether the carousel is still hovered.
  if (!hovered.el?.isConnected || !hovered.el.matches(":hover")) {
    hovered = null;
    return;
  }
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if ((e.target as HTMLElement | null)?.closest?.(OWNS_ARROWS)) return;
  if (document.querySelector('[aria-modal="true"]')) return; // the photo viewer has its own arrows
  e.preventDefault();
  hovered.step(e.key === "ArrowRight" ? 1 : -1);
}

/**
 * ← / → step a carousel while the mouse is over it, without clicking it first.
 * Stays out of the way of text fields, other controls that use arrows, open
 * pop-ups, and carousels that already handled the key while focused.
 */
export function useHoverArrows(step: (delta: 1 | -1) => void) {
  const me = useRef<Stepper>({ step, el: null });
  me.current.step = step;

  useEffect(() => {
    if (!installed) {
      document.addEventListener("keydown", onKey);
      installed = true;
    }
    const self = me.current;
    return () => {
      if (hovered === self) hovered = null;
    };
  }, []);

  return {
    onMouseEnter: (e: { currentTarget: Element }) => {
      me.current.el = e.currentTarget;
      hovered = me.current;
    },
    onMouseLeave: () => {
      if (hovered === me.current) hovered = null;
    },
  };
}
