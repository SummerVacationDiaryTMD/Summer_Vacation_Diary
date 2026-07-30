import { useEffect, useRef, useState, type CSSProperties } from "react";

import { formatKoreanDate, weatherLabel } from "../constants/diary";
import { DiaryExportError, exportDiaryImage } from "../services/diaryExport";
import {
  DiaryStoreError,
  getDiary,
  listDiaries,
  type DiaryRecord,
  type DiarySummary,
} from "../services/diaryStore";
import {
  daysInMonth,
  diariesByDay,
  koreanMonth,
  monthKeyOf,
  moveMonth,
} from "../utils/grapeCalendar";
import { DiaryButton } from "./DiaryButton";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
const DAILY_COMPLETE_STAMP_URL = "/stamps/daily-complete.png";

// Below this a drag reads as a tap or a stray finger movement rather than an
// intent to turn the page.
const SWIPE_THRESHOLD_PX = 48;

function GrapeArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      className="diary-calendar-arrow-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d={
          direction === "left"
            ? "M14.8 5.5 8.4 12l6.4 6.5"
            : "m9.2 5.5 6.4 6.5-6.4 6.5"
        }
      />
    </svg>
  );
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; summaries: DiarySummary[] };

/** Where the diary should appear to burst out of, relative to screen centre. */
interface PopOrigin {
  dx: number;
  dy: number;
}

/**
 * Rebuilt from the record rather than stored, so it always matches the diary
 * being looked at. Same shape as the name used right after finishing a diary.
 */
function diaryFileName(record: DiaryRecord): string {
  const saved = new Date(record.savedAt);
  const suffix = [saved.getHours(), saved.getMinutes(), saved.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  return `summer-diary-${record.date}-${suffix}.jpg`;
}

export function GrapeCalendarView() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  // One bunch is on screen at a time, so the month is view state rather than
  // something derived from the saved diaries.
  const [selectedMonth, setSelectedMonth] = useState(() =>
    monthKeyOf(new Date()),
  );
  // The viewer is a small album for one calendar date. It deliberately keeps
  // its own list so a swipe can never spill into the previous or next day.
  const [viewerEntries, setViewerEntries] = useState<DiarySummary[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [popOrigin, setPopOrigin] = useState<PopOrigin>({ dx: 0, dy: 0 });
  const [record, setRecord] = useState<DiaryRecord | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const summaries = await listDiaries();
        if (!cancelled) {
          setLoad({ status: "ready", summaries });
        }
      } catch (error) {
        if (!cancelled) {
          setLoad({
            status: "error",
            message:
              error instanceof DiaryStoreError
                ? error.userMessage
                : "저장된 일기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const summaries = load.status === "ready" ? load.summaries : [];
  const current = viewerIndex === null ? null : viewerEntries[viewerIndex];

  // The image lives in the entry, not the index, so it is fetched per page
  // instead of loading every diary's bytes up front.
  useEffect(() => {
    if (current === undefined || current === null) {
      return;
    }

    let cancelled = false;
    setRecord(null);
    setRecordError(null);
    setShareError(null);

    void (async () => {
      try {
        const found = await getDiary(current.id);
        if (cancelled) {
          return;
        }
        if (found === null) {
          setRecordError("이 일기를 찾을 수 없어요.");
          return;
        }
        setRecord(found);
      } catch (error) {
        if (!cancelled) {
          setRecordError(
            error instanceof DiaryStoreError
              ? error.userMessage
              : "일기를 불러오지 못했어요.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [current]);

  const [selectedYear, selectedMonthNumber] = selectedMonth
    .split("-")
    .map(Number);
  const firstDay = new Date(
    selectedYear,
    selectedMonthNumber - 1,
    1,
  ).getDay();
  // JavaScript starts weeks on Sunday. The picture-diary calendar starts on
  // Monday, so Sunday moves from index 0 to the last column.
  const leadingBlankCount = (firstDay + 6) % 7;
  const dayCount = daysInMonth(selectedMonth);
  const calendarCells = [
    ...Array.from({ length: leadingBlankCount }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => index + 1),
  ];
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push(null);
  }
  const byDay = diariesByDay(summaries, selectedMonth);
  const monthIsEmpty = Object.keys(byDay).length === 0;

  const step = (delta: number) => {
    setViewerIndex((index) => {
      if (index === null) {
        return null;
      }
      const next = index + delta;
      return next < 0 || next >= viewerEntries.length ? index : next;
    });
  };

  const openDay = (entries: DiarySummary[], bead: HTMLElement) => {
    if (entries.length === 0) {
      return;
    }

    // Measured at tap time so the diary grows out of the bead the user actually
    // pressed, not from a fixed point on screen.
    const rect = bead.getBoundingClientRect();
    setPopOrigin({
      dx: rect.left + rect.width / 2 - window.innerWidth / 2,
      dy: rect.top + rect.height / 2 - window.innerHeight / 2,
    });
    // listDiaries already orders entries on the same date newest first.
    setViewerEntries([...entries]);
    setViewerIndex(0);
  };

  const share = async () => {
    if (record === null || sharing) {
      return;
    }

    setSharing(true);
    setShareError(null);
    try {
      await exportDiaryImage(record.imageDataUrl, diaryFileName(record));
    } catch (error) {
      setShareError(
        error instanceof DiaryExportError
          ? error.userMessage
          : "이미지를 공유하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setSharing(false);
    }
  };

  const popStyle = {
    "--grape-pop-dx": `${popOrigin.dx}px`,
    "--grape-pop-dy": `${popOrigin.dy}px`,
  } as CSSProperties;

  return (
    // The viewer is a sibling of the step body, not a child of it. .step-body
    // is z-index 1, so anything inside it is stuck below the bottom bar at
    // z-index 50 no matter how high its own z-index goes — the 돌아가기 button
    // would sit on top of the diary, bright and still tappable. Out here the
    // viewer shares .app-shell's stacking context and its z-index counts.
    <>
      <div className="step-body diary-calendar-view">
        <section className="diary-calendar-paper" aria-labelledby="diary-month">
          <div className="diary-calendar-month-picker">
            <DiaryButton
              tone="secondary"
              stable
              aria-label="이전 달"
              onClick={() =>
                setSelectedMonth((current) => moveMonth(current, -1))
              }
            >
              <GrapeArrow direction="left" />
            </DiaryButton>
            <h2 id="diary-month">{koreanMonth(selectedMonth)}</h2>
            <DiaryButton
              tone="secondary"
              stable
              aria-label="다음 달"
              onClick={() =>
                setSelectedMonth((current) => moveMonth(current, 1))
              }
            >
              <GrapeArrow direction="right" />
            </DiaryButton>
          </div>

          <div className="diary-calendar-grid" role="grid">
            <div className="diary-calendar-weekdays" role="row">
              {WEEKDAYS.map((weekday, index) => (
                <div
                  key={weekday}
                  className={`diary-calendar-weekday weekday-${index}`}
                  role="columnheader"
                >
                  {weekday}
                </div>
              ))}
            </div>

            <div className="diary-calendar-days">
              {calendarCells.map((day, index) => {
                if (day === null) {
                  return (
                    <span
                      className="diary-calendar-cell is-empty"
                      key={`empty-${index}`}
                      aria-hidden="true"
                    />
                  );
                }

                const saved = byDay[day] ?? [];
                const first = saved[0];
                const hasDiaries = first !== undefined;
                const weekdayIndex = index % 7;

                return (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    className={`diary-calendar-cell weekday-${weekdayIndex}${hasDiaries ? " has-diaries" : ""}`}
                    disabled={!hasDiaries}
                    aria-label={
                      hasDiaries
                        ? `${day}일, 저장된 일기 ${saved.length}개 보기`
                        : `${day}일, 완성한 일기 없음`
                    }
                    onClick={(event) => {
                      if (saved.length > 0) {
                        openDay(saved, event.currentTarget);
                      }
                    }}
                  >
                    <span className="diary-calendar-day">{day}</span>
                    {hasDiaries && (
                      <img
                        className="diary-calendar-stamp"
                        src={DAILY_COMPLETE_STAMP_URL}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {load.status === "loading" && (
            <p className="diary-calendar-message" role="status">
              일기 달력을 불러오는 중…
            </p>
          )}

          {load.status === "error" && (
            <p
              className="diary-calendar-message diary-calendar-message-error"
              role="alert"
            >
              {load.message}
            </p>
          )}

          {load.status === "ready" && monthIsEmpty && (
            <p className="diary-calendar-message">
              이 달에는 아직 완성한 일기가 없어요. 첫 일기를 써 보세요!
            </p>
          )}
        </section>
      </div>

      {current !== null && current !== undefined && (
        // Covers the whole screen, header and bottom bar included, so the only
        // sharp and bright thing left is the diary itself.
        <div
          className="grape-viewer-layer"
          role="dialog"
          aria-modal="true"
          aria-label={`${formatKoreanDate(current.date)}에 저장된 일기 ${viewerEntries.length}편`}
          onTouchStart={(event) => {
            touchStartXRef.current = event.changedTouches[0].clientX;
          }}
          onTouchEnd={(event) => {
            const startX = touchStartXRef.current;
            touchStartXRef.current = null;
            if (startX === null) {
              return;
            }
            const delta = event.changedTouches[0].clientX - startX;
            if (Math.abs(delta) < SWIPE_THRESHOLD_PX) {
              return;
            }
            step(delta < 0 ? 1 : -1);
          }}
        >
          {/* Mounts once per open, so the pop animation plays on opening and
              not again on every swipe. */}
          <div className="grape-viewer-card" style={popStyle}>
            <div className="grape-viewer-head">
              <p className="grape-viewer-day-badge">
                {formatKoreanDate(current.date)}의 그림일기
                <strong>{viewerEntries.length}편</strong>
              </p>
              <p className="grape-viewer-title">
                {current.title.trim() === "" ? "제목 없는 일기" : current.title}
              </p>
              <p className="grape-viewer-date">
                {weatherLabel(current.weather)}
              </p>
            </div>

            <div
              className={`grape-viewer-stage${viewerEntries.length > 1 ? " has-multiple" : ""}`}
            >
              {recordError !== null ? (
                <p className="grape-viewer-note" role="alert">
                  {recordError}
                </p>
              ) : record === null ? (
                <p className="grape-viewer-note">일기를 펴는 중이에요…</p>
              ) : (
                <img
                  className="grape-viewer-image"
                  src={record.imageDataUrl}
                  alt={`${formatKoreanDate(record.date)}에 쓴 그림일기`}
                />
              )}
            </div>

            <div className="grape-viewer-nav">
              <button
                type="button"
                className="grape-viewer-arrow"
                disabled={viewerIndex === 0}
                onClick={() => step(-1)}
                aria-label="이 날의 이전 일기"
              >
                ‹
              </button>

              <div className="grape-viewer-position">
                <span className="grape-viewer-count">
                  {(viewerIndex ?? 0) + 1} / {viewerEntries.length}
                </span>
                {viewerEntries.length > 1 && (
                  <span className="grape-viewer-dots" aria-hidden="true">
                    {viewerEntries.map((entry, index) => (
                      <i
                        key={entry.id}
                        className={index === viewerIndex ? "is-current" : ""}
                      />
                    ))}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="grape-viewer-arrow"
                disabled={viewerIndex === viewerEntries.length - 1}
                onClick={() => step(1)}
                aria-label="이 날의 다음 일기"
              >
                ›
              </button>
            </div>

            {shareError !== null && (
              <p className="grape-viewer-error" role="alert">
                {shareError}
              </p>
            )}

            <div className="grape-viewer-actions">
              <DiaryButton
                stable
                fullWidth
                disabled={record === null || sharing}
                aria-busy={sharing}
                onClick={() => void share()}
              >
                이미지 공유하기
              </DiaryButton>

              <DiaryButton
                tone="secondary"
                stable
                fullWidth
                disabled={sharing}
                onClick={() => setViewerIndex(null)}
              >
                달력으로 돌아가기
              </DiaryButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
