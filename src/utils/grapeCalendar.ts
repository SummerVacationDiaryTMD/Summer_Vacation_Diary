/**
 * Month arithmetic and bead rows for the grape calendar: one bunch per month,
 * one bead per day.
 *
 * The rows follow a fixed pattern rather than a real calendar grid. A weekday
 * grid would put day 1 in a different column every month and leave ragged
 * holes, which reads as a spreadsheet; the bunch only has to stay narrow at the
 * top and taper to a single bead at the tip.
 *
 * The pattern comes from the grape stylesheet on feature/stevechan, so the
 * silhouette matches what `.praise-grape-row` was drawn against — the first row
 * is deliberately short, and the last is a single bead.
 */

import type { DiarySummary } from "../services/diaryStore";

// Sums to 31, so a full month fills the bunch exactly and shorter months stop
// short of the tip.
const ROW_LENGTHS = [3, 5, 5, 5, 4, 3, 3, 2, 1];

/** "2026-07" — the key a month is addressed by, and its React key. */
export type MonthKey = string;

export function monthKeyOf(date: Date): MonthKey {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDate(key: MonthKey): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

/** Adds months, rolling the year over. Negative amounts step backwards. */
export function moveMonth(key: MonthKey, amount: number): MonthKey {
  const date = monthDate(key);
  return monthKeyOf(new Date(date.getFullYear(), date.getMonth() + amount, 1));
}

export function daysInMonth(key: MonthKey): number {
  const date = monthDate(key);
  // Day 0 of the next month is the last day of this one.
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function koreanMonth(key: MonthKey): string {
  const date = monthDate(key);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

/** Splits 1..dayCount into the bunch's rows, top row first. */
export function grapeRows(dayCount: number): number[][] {
  const rows: number[][] = [];
  let day = 1;

  for (const length of ROW_LENGTHS) {
    if (day > dayCount) {
      break;
    }
    const row: number[] = [];
    while (row.length < length && day <= dayCount) {
      row.push(day);
      day += 1;
    }
    rows.push(row);
  }

  // Unreachable while the pattern still sums to 31; keeps every day visible if
  // the silhouette is ever reshaped.
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
 * Groups one month's saved diaries by day. Only the selected month is built,
 * because the picker shows one bunch at a time.
 */
export function diariesByDay(
  summaries: DiarySummary[],
  month: MonthKey,
): Record<number, DiarySummary[]> {
  const byDay: Record<number, DiarySummary[]> = {};

  for (const summary of summaries) {
    if (!summary.date.startsWith(`${month}-`)) {
      continue;
    }
    // Split the string instead of parsing it as a Date: "2026-07-01" parses as
    // UTC midnight, which lands on the previous day for anyone behind UTC.
    const day = Number(summary.date.slice(8, 10));
    if (!day) {
      continue;
    }
    (byDay[day] ??= []).push(summary);
  }

  return byDay;
}
