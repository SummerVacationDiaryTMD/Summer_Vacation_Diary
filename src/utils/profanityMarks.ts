import check1 from "../assets/handwrites/processed/check1.png";
import check2 from "../assets/handwrites/processed/check2.png";

const PROFANITY_MARKS = [check1, check2];

/** Check-mark URLs that must be preloaded before the canvas export is drawn. */
export const PROFANITY_MARK_URLS = [...PROFANITY_MARKS];

export function pickProfanityMarkAsset(
  row: number,
  startColumn: number,
  length: number,
): string {
  return PROFANITY_MARKS[
    (row * 31 + startColumn * 7 + length) % PROFANITY_MARKS.length
  ];
}
