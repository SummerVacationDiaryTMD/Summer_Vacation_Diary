export interface DiaryDateParts {
  year: string;
  month: string;
  day: string;
  weekday: string;
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
