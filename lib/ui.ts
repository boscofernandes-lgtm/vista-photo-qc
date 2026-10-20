import { ShotCategory } from "./types";

export const CATEGORY_LABEL: Record<ShotCategory, string> = {
  cover_facade: "Cover & Facade",
  setups_interiors: "Setups / Interiors",
  lifestyle: "Lifestyle",
  other: "Other",
};

export function score01Color(x: number): string {
  if (x >= 0.75) return "var(--good)";
  if (x >= 0.5) return "var(--warn)";
  return "var(--bad)";
}

/**
 * Grade colour as a plain hex value (same colours as the --good / --warn / --bad
 * tokens). Callers append an alpha suffix (`${color}22`) for tinted pills, which
 * only works on hex — `var(--warn)22` is invalid CSS and was silently dropped.
 */
export function gradeColor(grade: string): string {
  switch (grade) {
    case "Outstanding":
      return "#59d2a4";
    case "Exceeds Expectations":
      return "#7ee0b4";
    case "Meets Expectations":
      return "#e3b94e";
    case "Needs Improvement":
      return "#f9a03f";
    default:
      return "#e07a6f";
  }
}

/** Short, plain names for photo problems, for tight spaces like cards and chips. */
const SHORT_FLAG: Record<string, string> = {
  "Blurry / soft focus": "Blurry",
  "Underexposed (too dark)": "Too dark",
  "Overexposed (too bright)": "Too bright",
  "Blown highlights": "Blown highlights",
  "Low resolution": "Low resolution",
  "Strong color cast": "Colour cast",
  "Noisy / grainy": "Grainy",
  "Weak framing / composition": "Weak framing",
  "Low overall quality score": "Low quality",
};

export function shortFlag(flag: string): string {
  return SHORT_FLAG[flag] ?? flag;
}
