import { useEffect, useMemo, useRef, useState } from "react";

import { STAMP_ALT_TEXT, STAMP_IMAGE_URLS } from "../constants/stamp";
import {
  aggregateCompletedDiaryStamp,
  getCompletedDiariesByDate,
  listCompletedDiaries,
  type CompletedDiary,
  type CompletedDiarySummary,
} from "../services/completedDiaryStore";
import { DiaryGalleryModal } from "./DiaryGalleryModal";

interface PraiseGrapeScreenProps {
  onClose: () => void;
}

const GRAPE_ROW_LENGTHS = [3, 5, 5, 5, 4, 3, 3, 2, 1] as const;

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthDate(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function moveMonth(key: string, amount: number): string {
  const date = monthDate(key);
  return monthKey(new Date(date.getFullYear(), date.getMonth() + amount, 1));
}

function daysInMonth(key: string): number {
  const date = monthDate(key);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function koreanMonth(key: string): string {
  const date = monthDate(key);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function splitDaysIntoRows(dayCount: number): number[][] {
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  let offset = 0;
  return GRAPE_ROW_LENGTHS.map((length) => {
    const row = days.slice(offset, offset + length);
    offset += length;
    return row;
  }).filter((row) => row.length > 0);
}

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

export function PraiseGrapeScreen({ onClose }: PraiseGrapeScreenProps) {
  const [selectedMonth, setSelectedMonth] = useState(() =>
    monthKey(new Date()),
  );
  const [diaries, setDiaries] = useState<CompletedDiarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [galleryDate, setGalleryDate] = useState<string | null>(null);
  const [galleryDiaries, setGalleryDiaries] = useState<CompletedDiary[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const galleryRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    void listCompletedDiaries()
      .then((items) => {
        if (!cancelled) {
          setDiaries(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      galleryRequestRef.current += 1;
    };
  }, []);

  const days = useMemo(
    () => splitDaysIntoRows(daysInMonth(selectedMonth)),
    [selectedMonth],
  );
  const diariesByDate = useMemo(() => {
    const grouped = new Map<string, CompletedDiarySummary[]>();
    diaries.forEach((diary) => {
      const current = grouped.get(diary.date) ?? [];
      current.push(diary);
      grouped.set(diary.date, current);
    });
    return grouped;
  }, [diaries]);

  const openGallery = (date: string) => {
    const requestId = galleryRequestRef.current + 1;
    galleryRequestRef.current = requestId;
    setGalleryDate(date);
    setGalleryDiaries([]);
    setGalleryLoading(true);
    void getCompletedDiariesByDate(date)
      .then((items) => {
        if (galleryRequestRef.current === requestId) {
          setGalleryDiaries(items);
        }
      })
      .catch(() => {
        if (galleryRequestRef.current === requestId) {
          setGalleryDiaries([]);
        }
      })
      .finally(() => {
        if (galleryRequestRef.current === requestId) {
          setGalleryLoading(false);
        }
      });
  };

  return (
    <main className="praise-grape-screen">
      <header className="praise-grape-top">
        <button
          type="button"
          className="praise-grape-back"
          aria-label="일기 만들기로 돌아가기"
          onClick={onClose}
        >
          <GrapeArrow direction="left" />
        </button>
        <div>
          <h1>칭찬 포도</h1>
          <p>매일의 도장을 포도알에 차곡차곡 모아요.</p>
        </div>
      </header>

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
            onClick={() => setSelectedMonth((current) => moveMonth(current, 1))}
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
            <path className="praise-grape-stem" d="M120 72c6-27 22-43 48-54" />
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
            {days.map((row) => (
              <div className="praise-grape-row" key={row[0]}>
                {row.map((day) => {
                  const date = `${selectedMonth}-${String(day).padStart(2, "0")}`;
                  const dayDiaries = diariesByDate.get(date) ?? [];
                  const stamp = aggregateCompletedDiaryStamp(dayDiaries);
                  const count = dayDiaries.length;

                  return (
                    <button
                      key={date}
                      type="button"
                      className={`praise-grape-berry${count > 0 ? " has-diaries" : ""}`}
                      aria-label={
                        count > 0
                          ? `${day}일, 완성 일기 ${count}개, ${
                              stamp === null
                                ? "도장 없음"
                                : STAMP_ALT_TEXT[stamp]
                            }`
                          : `${day}일, 완성한 일기 없음`
                      }
                      disabled={count === 0}
                      onClick={() => openGallery(date)}
                    >
                      {stamp !== null && (
                        <img
                          className={`praise-grape-stamp praise-grape-stamp-${stamp}`}
                          src={STAMP_IMAGE_URLS[stamp]}
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                        />
                      )}
                      <span className="praise-grape-day">{day}</span>
                      {count > 1 && (
                        <span className="praise-grape-count" aria-hidden="true">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="praise-grape-legend" aria-label="도장 안내">
          {(["great", "effort"] as const).map((stamp) => (
            <span key={stamp}>
              <img src={STAMP_IMAGE_URLS[stamp]} alt="" aria-hidden="true" />
              {STAMP_ALT_TEXT[stamp].replace(" 도장", "")}
            </span>
          ))}
        </div>

        {loading && (
          <p className="praise-grape-message" role="status">
            칭찬 포도를 불러오는 중…
          </p>
        )}
        {!loading && loadError && (
          <p className="praise-grape-message praise-grape-message-error">
            칭찬 포도를 불러오지 못했어요. 잠시 후 다시 열어 주세요.
          </p>
        )}
        {!loading &&
          !loadError &&
          !diaries.some((diary) => diary.date.startsWith(selectedMonth)) && (
            <p className="praise-grape-message">
              아직 완성한 일기가 없어요. 첫 포도알을 채워 보세요!
            </p>
          )}
      </section>

      <DiaryGalleryModal
        date={galleryDate}
        diaries={galleryDiaries}
        loading={galleryLoading}
        onClose={() => {
          galleryRequestRef.current += 1;
          setGalleryDate(null);
          setGalleryDiaries([]);
          setGalleryLoading(false);
        }}
      />
    </main>
  );
}
