import { Modal } from "@toss/tds-mobile";
import { useEffect, useRef, useState } from "react";

import { formatKoreanDate } from "../constants/diary";
import type { CompletedDiary } from "../services/completedDiaryStore";
import { DiaryButton } from "./DiaryButton";

interface DiaryGalleryModalProps {
  date: string | null;
  diaries: CompletedDiary[];
  loading: boolean;
  onClose: () => void;
}

const SWIPE_THRESHOLD_PX = 42;

export function DiaryGalleryModal({
  date,
  diaries,
  loading,
  onClose,
}: DiaryGalleryModalProps) {
  const [index, setIndex] = useState(0);
  const touchStartXRef = useRef<number | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setIndex(0);
  }, [date, diaries]);

  const hasMultiple = diaries.length > 1;
  const currentDiary = diaries[index];
  const showPrevious = () => {
    if (!hasMultiple) {
      return;
    }
    setIndex((current) => Math.max(0, current - 1));
  };
  const showNext = () => {
    if (!hasMultiple) {
      return;
    }
    setIndex((current) => Math.min(diaries.length - 1, current + 1));
  };

  return (
    <Modal open={date !== null} onOpenChange={(open) => !open && onClose()}>
      <Modal.Overlay />
      <Modal.Content
        className="app-modal-panel praise-gallery-panel"
        aria-labelledby="praise-gallery-title"
        aria-describedby="praise-gallery-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="app-modal-layout praise-gallery-layout">
          <header className="praise-gallery-header">
            <div>
              <h2
                ref={titleRef}
                id="praise-gallery-title"
                className="app-modal-title"
                tabIndex={-1}
              >
                {date === null ? "완성 일기" : formatKoreanDate(date)}
              </h2>
              <p id="praise-gallery-description">
                이날 완성한 그림일기를 모아 봤어요.
              </p>
            </div>
            <button
              type="button"
              className="praise-gallery-close"
              aria-label="완성 일기 닫기"
              onClick={onClose}
            >
              ×
            </button>
          </header>

          <div
            className="praise-gallery-stage"
            onTouchStart={(event) => {
              touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const startX = touchStartXRef.current;
              const endX = event.changedTouches[0]?.clientX;
              touchStartXRef.current = null;

              if (startX === null || endX === undefined) {
                return;
              }
              const distance = endX - startX;
              if (distance > SWIPE_THRESHOLD_PX) {
                showPrevious();
              } else if (distance < -SWIPE_THRESHOLD_PX) {
                showNext();
              }
            }}
          >
            {loading && (
              <p className="praise-gallery-loading" role="status">
                완성 일기를 불러오는 중…
              </p>
            )}

            {!loading && currentDiary !== undefined && (
              <img
                key={currentDiary.id}
                className="praise-gallery-image"
                src={currentDiary.imageDataUrl}
                alt={`${formatKoreanDate(currentDiary.date)}에 완성한 그림일기 ${index + 1}`}
                draggable={false}
              />
            )}
            {!loading && currentDiary === undefined && (
              <p className="praise-gallery-loading">
                완성 일기 이미지를 불러오지 못했어요.
              </p>
            )}
          </div>

          {hasMultiple && (
            <div className="praise-gallery-navigation">
              <DiaryButton
                tone="secondary"
                stable
                disabled={index === 0}
                onClick={showPrevious}
              >
                이전
              </DiaryButton>
              <output
                className="praise-gallery-page"
                aria-live="polite"
                aria-label={`${diaries.length}개 중 ${index + 1}번째 일기`}
              >
                {index + 1} / {diaries.length}
              </output>
              <DiaryButton
                tone="secondary"
                stable
                disabled={index === diaries.length - 1}
                onClick={showNext}
              >
                다음
              </DiaryButton>
            </div>
          )}
        </div>
      </Modal.Content>
    </Modal>
  );
}
