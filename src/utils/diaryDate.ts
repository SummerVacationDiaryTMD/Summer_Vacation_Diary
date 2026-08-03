export interface DiaryDateParts {
  year: string;
  month: string;
  day: string;
  weekday: string;
}

// toISOString() reports UTC, which is "yesterday" for Korean users before
// 09:00. Build the date from local parts so the draft uses the device's
// current calendar date.
export function localTodayString(referenceDate = new Date()): string {
  const month = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const day = String(referenceDate.getDate()).padStart(2, "0");
  return `${referenceDate.getFullYear()}-${month}-${day}`;
}

/**
 * Produces the exact date labels shared by the DOM preview and export canvas.
 * Keeping this in one place prevents the saved image from formatting a date
 * differently from the screen the user approved.
 */
export function diaryDateParts(date: string): DiaryDateParts {
  const [year = "", rawMonth = "", rawDay = ""] = date.split("-");
  const diaryDate = new Date(`${date}T00:00:00`);

  return {
    year,
    month: String(Number(rawMonth)).padStart(2, "0"),
    day: String(Number(rawDay)).padStart(2, "0"),
    weekday: Number.isNaN(diaryDate.getTime())
      ? ""
      : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(
          diaryDate,
        ),
  };
}
