"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeBatch } from "@/lib/analyze";
import { scoreProperty } from "@/lib/scoring";
import { recommend } from "@/lib/recommend";
import {
  AIRubricResult,
  ImageAnalysis,
  ImageInput,
  PropertyMeta,
  PropertyScore,
  Recommendations,
  SubBrand,
  Weights,
} from "@/lib/types";

/** Where one villa's QC check is up to. */
export type VillaRun =
  | { status: "queued" }
  | {
      status: "running";
      done: number;
      total: number;
      /** True while the automatic AI rubric pass runs (after the photo check). */
      ai?: boolean;
    }
  | {
      status: "done";
      analyses: ImageAnalysis[];
      meta: PropertyMeta;
      ai: AIRubricResult | null;
      /**
       * The sub-brand the AI result was judged against. AI scores only count
       * under that sub-brand, so switching away and back keeps paid results.
       */
      aiBrand?: SubBrand;
      /** Set when an automatic AI pass was attempted and failed (the villa is scored on CV only). */
      aiError?: string;
    }
  | { status: "error"; error: string };

/** A villa's "download photos in this order" job. Kept here so it survives the report panel closing. */
export type Download =
  | { state: "idle" }
  | { state: "working"; done: number; total: number }
  | { state: "done"; count: number; failed: string[] }
  | { state: "error"; message: string };

/** What to analyse for a villa, produced by the tab that owns it. */
export interface CheckPlan {
  inputs: ImageInput[];
  meta: PropertyMeta;
}

export interface AIOutcome {
  ai: AIRubricResult | null;
  aiError?: string;
}

/** Below this width the report opens as a full-screen overlay instead of a side panel (see globals.css). */
export const isNarrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches;

/**
 * The check engine every tab shares: a queue that checks one villa at a time
 * (with live progress), which report is open, the photo viewer, carousel
 * positions, gallery arrangements and the "villa is checked" toast.
 *
 * `prepare` turns a villa key into analyser inputs (it may fetch / scrape first);
 * `afterAnalyze` optionally adds an AI rubric result (Bulk's automatic AI pass).
 */
export function useVillaChecks({
  prepare,
  afterAnalyze,
  brand,
  weights,
  notify = true,
}: {
  prepare: (key: string) => Promise<CheckPlan>;
  /** Return null when there's no AI pass for this villa (e.g. Bulk with AI off). */
  afterAnalyze?: (key: string, analyses: ImageAnalysis[], meta: PropertyMeta) => Promise<AIOutcome> | null;
  brand: SubBrand;
  weights: Weights;
  /** Show a "villa is checked" toast for checks finishing in the background (off for Bulk's batch). */
  notify?: boolean;
}) {
  const [runs, setRuns] = useState<Record<string, VillaRun>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ key: string; index: number } | null>(null);
  const [slideIdx, setSlideIdx] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const [downloads, setDownloads] = useState<Record<string, Download>>({});
  const [toast, setToast] = useState<{ text: string; key: string } | null>(null);

  const runsRef = useRef(runs);
  runsRef.current = runs;
  const selectedRef = useRef(selectedKey);
  selectedRef.current = selectedKey;
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const afterRef = useRef(afterAnalyze);
  afterRef.current = afterAnalyze;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const brandRef = useRef(brand);
  brandRef.current = brand;
  const running = useRef(false);

  function analyze(key: string) {
    setRuns((r) => ({ ...r, [key]: { status: "queued" } }));
    setQueue((q) => (q.includes(key) ? q : [...q, key]));
    // On wide screens, show "Checking <villa>…" in the side panel straight away,
    // unless a report is open there. On phones/tablets the report is a
    // full-screen overlay, so don't cover the page: the card shows progress and
    // a toast offers the report when it's ready.
    const sel = selectedRef.current;
    if (!isNarrow() && (sel === null || sel === key || runsRef.current[sel]?.status === "error")) {
      // Update the ref now too: when a batch queues several villas in one go, the
      // first one should own the panel, not the last.
      selectedRef.current = key;
      setSelectedKey(key);
    }
  }

  /** Drop every villa that is still waiting (the one being checked finishes). */
  function cancelQueued() {
    const waiting = queue.filter((k) => runsRef.current[k]?.status === "queued");
    if (waiting.length === 0) return;
    setQueue((q) => q.filter((k) => !waiting.includes(k)));
    setRuns((r) => {
      const next = { ...r };
      for (const k of waiting) delete next[k];
      return next;
    });
  }

  /** Forget everything about these villas (e.g. a new Bulk batch replaces the old one). */
  function forget(keys: string[]) {
    if (keys.length === 0) return;
    const drop = new Set(keys);
    setQueue((q) => q.filter((k) => !drop.has(k) || runsRef.current[k]?.status === "running"));
    setRuns((r) => {
      const next = { ...r };
      for (const k of keys) if (next[k]?.status !== "running") delete next[k];
      return next;
    });
    if (selectedRef.current !== null && drop.has(selectedRef.current)) {
      selectedRef.current = null; // so the next batch's first villa can take the panel
      setSelectedKey(null);
    }
  }

  useEffect(() => {
    if (running.current || queue.length === 0) return;
    const key = queue[0];
    running.current = true;
    void runCheck(key).finally(() => {
      running.current = false;
      setQueue((q) => q.filter((k) => k !== key));
    });
    // runCheck only touches setters and refs, so it can't go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  async function runCheck(key: string) {
    setRuns((r) => ({ ...r, [key]: { status: "running", done: 0, total: 0 } }));
    try {
      const { inputs, meta } = await prepareRef.current(key);
      if (inputs.length === 0) throw new Error("This listing has no photos to check.");
      setRuns((r) => ({ ...r, [key]: { status: "running", done: 0, total: inputs.length } }));
      const analyses = await analyzeBatch(inputs, (pr) =>
        setRuns((r) => ({ ...r, [key]: { status: "running", done: pr.done, total: pr.total } }))
      );
      if (analyses.length === 0) throw new Error("None of the photos could be read.");
      // The AI pass (if any) is judged against the sub-brand of this moment.
      const askedBrand = brandRef.current;
      const pending = afterRef.current?.(key, analyses, meta) ?? null;
      if (pending) {
        setRuns((r) => ({ ...r, [key]: { status: "running", done: analyses.length, total: analyses.length, ai: true } }));
      }
      const ai = pending ? await pending : { ai: null };
      setRuns((r) => ({
        ...r,
        [key]: { status: "done", analyses, meta, ai: ai.ai, aiBrand: askedBrand, aiError: ai.aiError },
      }));
      // If the panel is already waiting on this villa, its report simply appears.
      // Otherwise offer it in a toast: never swap out a report that's being read,
      // and never reopen a panel the user closed.
      const sel = selectedRef.current;
      if (sel !== key) {
        if (sel !== null && runsRef.current[sel]?.status === "error") setSelectedKey(key);
        else if (notifyRef.current) setToast({ text: `${meta.name} is checked.`, key });
      }
    } catch (e: any) {
      setRuns((r) => ({ ...r, [key]: { status: "error", error: e?.message ?? "Something went wrong." } }));
    }
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  // Escape closes the full-screen report on phones/tablets (the photo viewer
  // handles its own Escape while it's open).
  useEffect(() => {
    if (selectedKey === null || viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isNarrow()) setSelectedKey(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedKey, viewer]);

  // Scores follow the shared sub-brand / weights, so cards and panel agree.
  const scored = useMemo(() => {
    const m: Record<string, { score: PropertyScore; rec: Recommendations }> = {};
    for (const [k, run] of Object.entries(runs)) {
      if (run.status === "done") {
        m[k] = {
          // AI scores only count under the sub-brand they were judged against.
          score: scoreProperty(run.analyses, weights, { brand, ai: run.aiBrand === brand ? run.ai : null }),
          rec: recommend(run.analyses),
        };
      }
    }
    return m;
  }, [runs, weights, brand]);

  function setAI(key: string, ai: AIRubricResult | null) {
    setRuns((r) => {
      const run = r[key];
      return run && run.status === "done"
        ? { ...r, [key]: { ...run, ai, aiBrand: brandRef.current, aiError: undefined } }
        : r;
    });
  }

  function showPhoto(key: string, index: number) {
    setSlideIdx((m) => ({ ...m, [key]: index }));
    setViewer({ key, index });
  }

  function step(key: string, delta: number, count: number) {
    setSlideIdx((m) => {
      const cur = Math.min(m[key] ?? 0, count - 1);
      return { ...m, [key]: (cur + delta + count) % count };
    });
  }

  function setDownload(key: string, d: Download) {
    setDownloads((m) => ({ ...m, [key]: d }));
  }

  function setOrder(key: string, order: string[] | null) {
    setOrders((m) => {
      const next = { ...m };
      if (order) next[key] = order;
      else delete next[key];
      return next;
    });
  }

  return {
    runs,
    queue,
    scored,
    analyze,
    cancelQueued,
    forget,
    selectedKey,
    setSelectedKey,
    viewer,
    setViewer,
    showPhoto,
    slideIdx,
    step,
    orders,
    setOrder,
    downloads,
    setDownload,
    toast,
    setToast,
    setAI,
  };
}

export type VillaChecks = ReturnType<typeof useVillaChecks>;
