"use client";

import { useSyncExternalStore } from "react";

/**
 * The report panel's width (px) when someone has dragged it, shared by every tab
 * and remembered in this browser. null = the default width.
 */
const KEY = "framecheck.reportWidth";
export const MIN_PANEL_WIDTH = 380;

let width: number | null = null;
let loaded = false;
const subscribers = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const w = Number(window.localStorage.getItem(KEY));
    width = Number.isFinite(w) && w >= MIN_PANEL_WIDTH ? w : null;
  } catch {
    width = null;
  }
}

export function setPanelWidth(w: number | null) {
  width = w === null ? null : Math.max(MIN_PANEL_WIDTH, Math.round(w));
  try {
    if (width === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(width));
  } catch {
    // Private windows can refuse storage; the width still applies until reload.
  }
  subscribers.forEach((f) => f());
}

export function usePanelWidth(): number | null {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => {
      load();
      return width;
    },
    () => null
  );
}
