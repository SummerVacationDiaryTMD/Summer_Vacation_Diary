/** Month navigation and saved-diary grouping for the calendar view. */

import type { DiarySummary } from "../services/diaryStore";

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

/**
 * Groups one month's saved diaries by day. Only the selected month is built,
 * because the picker shows one calendar month at a time.
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
