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

export function gradeColor(grade: string): string {
  switch (grade) {
    case "Outstanding":
      return "var(--good)";
    case "Exceeds Expectations":
      return "#7ee0b4";
    case "Meets Expectations":
      return "var(--warn)";
    case "Needs Improvement":
      return "#f9a03f";
    default:
      return "var(--bad)";
  }
}
