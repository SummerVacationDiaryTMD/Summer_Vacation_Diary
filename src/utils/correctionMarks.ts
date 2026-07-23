// Hand-drawn correction mark assets (red crayon strokes scanned by the team,
// preprocessed into trimmed transparent PNGs — regenerate with
// scripts/process_handwrites.py; the untouched originals stay in
// src/assets/handwrites/ and are not bundled because nothing imports them).
import circle1 from "../assets/handwrites/processed/circle1.png";
import circle2 from "../assets/handwrites/processed/circle2.png";
import circle3 from "../assets/handwrites/processed/circle3.png";
import circle4 from "../assets/handwrites/processed/circle4.png";
import circle5 from "../assets/handwrites/processed/circle5.png";
import line1 from "../assets/handwrites/processed/line1.png";
import line2 from "../assets/handwrites/processed/line2.png";
import line3 from "../assets/handwrites/processed/line3.png";

const CIRCLE_MARKS = [circle1, circle2, circle3, circle4, circle5];
const LINE_MARKS = [line1, line2, line3];

/** Every mark URL, for callers that need to preload them (canvas export). */
export const CORRECTION_MARK_URLS = [...CIRCLE_MARKS, ...LINE_MARKS];

/**
 * Picks a mark variant from the run's grid position. Deterministic on
 * purpose (no Math.random): the DOM preview and the canvas export build
 * identical runs from the same diary, so seeding by run coordinates
 * guarantees both render the exact same drawing.
 */
export function pickCorrectionMarkAsset(
  mark: "circle" | "underline",
  row: number,
  startColumn: number,
  length: number,
): string {
  const pool = mark === "circle" ? CIRCLE_MARKS : LINE_MARKS;
  return pool[(row * 31 + startColumn * 7 + length) % pool.length];
}
