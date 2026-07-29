/**
 * Arranges saved diaries into the grape-bunch calendar: one bunch per month,
 * one bead per day.
 *
 * The bead rows follow a fixed pattern rather than a real calendar grid. A
 * weekday grid would put day 1 in a different column every month and leave
 * ragged holes, which reads as a spreadsheet; the bunch silhouette only needs
 * to stay wide at the top and taper to a tip, so a pattern that always sums to
 * more than any month length gets there with no per-month special cases.
 *
 * This is the temporary layout that the real grape stylesheet will replace, so
 * it stays deliberately plain: numbers in, rows out, no drawing logic.
 */

import type { DiarySummary } from "../services/diaryStore";

// Sums to 36, so it covers a 31-day month and simply stops early on shorter
// ones — the final short row becomes the tip of the bunch.
const ROW_PATTERN = [5, 6, 5, 6, 5, 4, 3, 2];

export interface GrapeMonth {
  /** "2026-07", also used as the React key. */
  key: string;
  year: number;
  /** 1-12, as people say it, not the 0-11 the Date constructor wants. */
  month: number;
  rows: number[][];
  /** Day of month → diaries saved for that day, in the order given. */
  diariesByDay: Record<number, DiarySummary[]>;
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Splits 1..dayCount into the bunch's rows, top row first. */
export function grapeRows(dayCount: number): number[][] {
  const rows: number[][] = [];
  let day = 1;

  for (const width of ROW_PATTERN) {
    if (day > dayCount) {
      break;
    }
    const row: number[] = [];
    while (row.length < width && day <= dayCount) {
      row.push(day);
      day += 1;
    }
    rows.push(row);
  }

  // Unreachable for real months; keeps every day visible if the pattern
  // is ever shortened.
  if (day <= dayCount) {
    const rest: number[] = [];
    while (day <= dayCount) {
      rest.push(day);
      day += 1;
    }
    rows.push(rest);
  }

  return rows;
}

/**
 * One bunch per month that has a diary, plus the current month so there is
 * always somewhere to earn the first stamp. Newest month first, so the month
 * being written in is on screen without scrolling.
 */
export function buildGrapeMonths(
  summaries: DiarySummary[],
  today: Date,
): GrapeMonth[] {
  const byMonth = new Map<string, Record<number, DiarySummary[]>>();

  const ensure = (year: number, month: number) => {
    const key = monthKey(year, month);
    let bucket = byMonth.get(key);
    if (bucket === undefined) {
      bucket = {};
      byMonth.set(key, bucket);
    }
    return bucket;
  };

  ensure(today.getFullYear(), today.getMonth() + 1);

  for (const summary of summaries) {
    // Split the string instead of parsing it as a Date: "2026-07-01" parses as
    // UTC midnight, which lands on the previous day for anyone behind UTC.
    const [year, month, day] = summary.date.split("-").map(Number);
    if (!year || !month || !day) {
      continue;
    }
    const bucket = ensure(year, month);
    (bucket[day] ??= []).push(summary);
  }

  return [...byMonth.keys()]
    .sort((left, right) => (left < right ? 1 : -1))
    .map((key) => {
      const [year, month] = key.split("-").map(Number);
      return {
        key,
        year,
        month,
        rows: grapeRows(daysInMonth(year, month)),
        diariesByDay: byMonth.get(key) ?? {},
      };
    });
}
