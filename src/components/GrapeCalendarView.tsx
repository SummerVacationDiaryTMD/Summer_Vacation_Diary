import { useEffect, useRef, useState, type CSSProperties } from "react";

// Only the "참 잘했어요" stamp is used: DiaryRecord does not keep which stamp a
// diary earned, so the two-stamp legend from the ported design is left out
// rather than shown with a distinction this screen cannot actually make.
import { STAMP_IMAGE_URLS } from "../constants/stamp";
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
  grapeRows,
  koreanMonth,
  monthKeyOf,
  moveMonth,
} from "../utils/grapeCalendar";
import { DiaryButton } from "./DiaryButton";

// Below this a drag reads as a tap or a stray finger movement rather than an
// intent to turn the page.
const SWIPE_THRESHOLD_PX = 48;

function GrapeArrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      className="praise-grape-arrow-icon"
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
  // Index into the chronological list, not into a single day: swiping crosses
  // day and month boundaries.
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
  // listDiaries returns newest first; reading a diary book runs the other way,
  // so swiping right moves forward in time.
  const chronological = [...summaries].reverse();
  const current = viewerIndex === null ? null : chronological[viewerIndex];

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

  const rows = grapeRows(daysInMonth(selectedMonth));
  const byDay = diariesByDay(summaries, selectedMonth);
  const monthIsEmpty = Object.keys(byDay).length === 0;

  const step = (delta: number) => {
    setViewerIndex((index) => {
      if (index === null) {
        return null;
      }
      const next = index + delta;
      return next < 0 || next >= chronological.length ? index : next;
    });
  };

  const openDay = (id: string, bead: HTMLElement) => {
    const index = chronological.findIndex((summary) => summary.id === id);
    if (index === -1) {
      return;
    }

    // Measured at tap time so the diary grows out of the bead the user actually
    // pressed, not from a fixed point on screen.
    const rect = bead.getBoundingClientRect();
    setPopOrigin({
      dx: rect.left + rect.width / 2 - window.innerWidth / 2,
      dy: rect.top + rect.height / 2 - window.innerHeight / 2,
    });
    setViewerIndex(index);
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
    <div className="step-body grape-calendar-view">
      <div className="praise-grape-screen">
        <section className="praise-grape-paper" aria-labelledby="grape-month">
          <div className="praise-grape-month-picker">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() =>
                setSelectedMonth((current) => moveMonth(current, -1))
              }
            >
              <GrapeArrow direction="left" />
            </button>
            <h2 id="grape-month">{koreanMonth(selectedMonth)}</h2>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() =>
                setSelectedMonth((current) => moveMonth(current, 1))
              }
            >
              <GrapeArrow direction="right" />
            </button>
          </div>

          <div className="praise-grape-illustration">
            <svg
              className="praise-grape-leaves"
              viewBox="0 0 220 110"
              aria-hidden="true"
            >
              <path
                className="praise-grape-stem"
                d="M120 72c6-27 22-43 48-54"
              />
              <path d="M118 70C81 65 51 49 35 18c34-8 68 5 83 52Z" />
              <path d="M125 68c6-31 28-53 58-62 4 31-13 56-58 62Z" />
              <path
                className="praise-grape-leaf-line"
                d="M48 28c26 11 46 25 66 41M174 17c-22 15-35 31-45 49"
              />
            </svg>

            <div className="praise-grape-sign" aria-hidden="true">
              칭찬
              <br />
              포도
            </div>

            <div className="praise-grape-cluster">
              {rows.map((row) => (
                <div className="praise-grape-row" key={row[0]}>
                  {row.map((day) => {
                    const saved = byDay[day] ?? [];
                    const first = saved[0];
                    const ripe = first !== undefined;

                    return (
                      <button
                        key={day}
                        type="button"
                        className={`praise-grape-berry${ripe ? " has-diaries" : ""}`}
                        disabled={!ripe}
                        aria-label={
                          ripe
                            ? `${day}일, 저장된 일기 ${saved.length}개 보기`
                            : `${day}일, 완성한 일기 없음`
                        }
                        onClick={(event) => {
                          if (first !== undefined) {
                            openDay(first.id, event.currentTarget);
                          }
                        }}
                      >
                        {ripe && (
                          <img
                            className="praise-grape-stamp"
                            src={STAMP_IMAGE_URLS.great}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                          />
                        )}
                        <span className="praise-grape-day">{day}</span>
                        {saved.length > 1 && (
                          <span
                            className="praise-grape-count"
                            aria-hidden="true"
                          >
                            {saved.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {load.status === "loading" && (
            <p className="praise-grape-message" role="status">
              칭찬 포도를 불러오는 중…
            </p>
          )}

          {load.status === "error" && (
            <p
              className="praise-grape-message praise-grape-message-error"
              role="alert"
            >
              {load.message}
            </p>
          )}

          {load.status === "ready" && monthIsEmpty && (
            <p className="praise-grape-message">
              이 달에는 아직 완성한 일기가 없어요. 첫 포도알을 채워 보세요!
            </p>
          )}
        </section>
      </div>

      {current !== null && current !== undefined && (
        // Covers the whole screen rather than sitting inside the scroll area:
        // the blur has to take the header and the bottom bar with it, or the
        // diary would look like it is floating on a half-dimmed page.
        <div
          className="grape-viewer-layer"
          role="dialog"
          aria-modal="true"
          aria-label="저장된 일기"
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
              <p className="grape-viewer-date">
                {formatKoreanDate(current.date)} ·{" "}
                {weatherLabel(current.weather)}
              </p>
              <p className="grape-viewer-title">
                {current.title.trim() === "" ? "제목 없는 일기" : current.title}
              </p>
            </div>

            <div className="grape-viewer-stage">
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
                aria-label="이전 일기"
              >
                ‹
              </button>

              <span className="grape-viewer-count">
                {(viewerIndex ?? 0) + 1} / {chronological.length}
              </span>

              <button
                type="button"
                className="grape-viewer-arrow"
                disabled={viewerIndex === chronological.length - 1}
                onClick={() => step(1)}
                aria-label="다음 일기"
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
    </div>
  );
}
