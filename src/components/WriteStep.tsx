import {
  Paragraph,
  TextArea,
  TextField,
  useDialog,
  useToast,
} from "@toss/tds-mobile";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  CONTENT_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  WEATHER_OPTIONS,
} from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import type { DiaryDraft, DiaryDraftPatch } from "../hooks/useDiaryDraft";
import { DiaryStoreError, getDiaryDateCapacity } from "../services/diaryStore";
import {
  diaryContentCellCount,
  fitDiaryContent,
} from "../utils/diaryFrameLayout";
import { DiaryButton } from "./DiaryButton";

interface WriteStepProps {
  draft: DiaryDraft;
  entryId: number;
  endAnchorRef: RefObject<HTMLDivElement>;
  onChange: (patch: DiaryDraftPatch) => void;
  onOpenCalendar: (date: string) => void;
}

// The form sits on a permanently cream sheet, so an adaptive token here would
// resolve to a near-white ink in dark mode. Fixed, like the date's own color.
const LABEL_INK = "#6B5E3F";
const CONTENT_MAX_LINES = 5;
const CONTENT_COUNTER_WIDTH = 48;

function exceedsDiaryWritingArea(
  value: string,
  element: HTMLTextAreaElement,
): boolean {
  const styles = window.getComputedStyle(element);
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return false;

  context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
  const letterSpacing = Number.parseFloat(styles.letterSpacing) || 0;
  const fullLineWidth = element.clientWidth;
  let row = 0;
  let lineWidth = 0;
  const lines = value.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const character of Array.from(line)) {
      const characterWidth =
        context.measureText(character).width + letterSpacing;
      const lineLimit =
        row === CONTENT_MAX_LINES - 1
          ? fullLineWidth - CONTENT_COUNTER_WIDTH
          : fullLineWidth;

      if (lineWidth > 0 && lineWidth + characterWidth > lineLimit) {
        row += 1;
        lineWidth = 0;
      }
      if (row >= CONTENT_MAX_LINES) return true;
      lineWidth += characterWidth;
    }

    row += 1;
    lineWidth = 0;
    if (row >= CONTENT_MAX_LINES && index < lines.length - 1) {
      return true;
    }
  }

  return false;
}

function formatDateValue(date: string): string {
  const [year, month, day] = date.split("-");

  if (year === undefined || month === undefined || day === undefined) {
    return date;
  }

  return `${year}. ${Number(month)}. ${Number(day)}.`;
}

/**
 * Step 2: title, diary text and weather. The date is shown but not editable —
 * a diary always belongs to the day it is written on.
 * All fields write straight into the shared draft, so leaving this screen
 * (or the app) never loses input — the draft hook persists it.
 */
export function WriteStep({
  draft,
  entryId,
  endAnchorRef,
  onChange,
  onOpenCalendar,
}: WriteStepProps) {
  const toast = useToast();
  const { openConfirm } = useDialog();
  const capacityCheckIdRef = useRef(0);
  const checkedEntryIdRef = useRef<number | null>(null);
  const [titleLimitShakeCount, setTitleLimitShakeCount] = useState(0);
  const [contentLimitShakeCount, setContentLimitShakeCount] = useState(0);
  const titleLength = Array.from(draft.title).length;
  const titleAtLimit = titleLength >= TITLE_MAX_LENGTH;
  const contentLength = diaryContentCellCount(draft.content);
  const handleContentChange = (value: string, element: HTMLTextAreaElement) => {
    const limitedContent = fitDiaryContent(
      value.split("\n").slice(0, CONTENT_MAX_LINES).join("\n"),
    );

    if (
      element.scrollHeight > element.clientHeight + 1 ||
      exceedsDiaryWritingArea(limitedContent, element)
    ) {
      return;
    }

    if (
      Array.from(limitedContent).length >= CONTENT_MAX_LENGTH &&
      contentLength < CONTENT_MAX_LENGTH
    ) {
      setContentLimitShakeCount((count) => count + 1);
    }

    onChange({ content: limitedContent });
  };
  const handleTitleChange = (value: string) => {
    const limitedTitle = Array.from(value).slice(0, TITLE_MAX_LENGTH).join("");

    if (
      Array.from(limitedTitle).length >= TITLE_MAX_LENGTH &&
      titleLength < TITLE_MAX_LENGTH
    ) {
      setTitleLimitShakeCount((count) => count + 1);
    }

    onChange({ title: limitedTitle });
  };
  const contentAtLimit = contentLength >= CONTENT_MAX_LENGTH;
  // A whitespace-only title also blocks the preview button (App.tsx trims it),
  // so surface the reason here instead of leaving the button silently disabled.
  const titleBlank = draft.title.length > 0 && draft.title.trim() === "";
  // The daily limit still applies even though the date is fixed, so warn on
  // arrival instead of letting the user write a whole diary that cannot be
  // saved. Every stored record for today counts: this diary is not saved yet,
  // so none of them is the one being written.
  const checkDiaryCapacity = useCallback(async () => {
    const checkId = capacityCheckIdRef.current + 1;
    capacityCheckIdRef.current = checkId;

    try {
      const capacity = await getDiaryDateCapacity(draft.date);
      if (checkId !== capacityCheckIdRef.current || !capacity.isFull) {
        return;
      }

      const openRecords = await openConfirm({
        title: "오늘 일기가 가득 찼어요",
        description: `하루에는 일기를 최대 ${capacity.limit}개까지 저장할 수 있어요. 오늘 새 일기를 쓰려면 기존 일기를 삭제해 주세요.`,
        confirmButton: <DiaryButton>일기장 보기</DiaryButton>,
        cancelButton: <DiaryButton tone="secondary">닫기</DiaryButton>,
        closeOnDimmerClick: false,
      });
      if (openRecords) {
        onOpenCalendar(draft.date);
      }
    } catch (error) {
      if (checkId !== capacityCheckIdRef.current) {
        return;
      }
      toast.openToast(
        error instanceof DiaryStoreError
          ? error.userMessage
          : "저장된 일기를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }, [draft.date, onOpenCalendar, openConfirm, toast]);

  useEffect(() => {
    if (checkedEntryIdRef.current === entryId) {
      return;
    }
    checkedEntryIdRef.current = entryId;
    void checkDiaryCapacity();
  }, [checkDiaryCapacity, entryId]);

  return (
    <div className="step-body write-form">
      <div className="write-form-surface">
        <section className="diary-form-section diary-title-section">
          {/* The date rides on the label row instead of owning a field of its
              own. It is fixed to the day the draft was created, so it is a
              caption on the page rather than something to fill in — and a
              labelled plate for a value that never changes just costs the
              sheet a whole section. The handwriting face is kept so it still
              reads as part of the diary and not as UI chrome. */}
          <div className="diary-title-heading">
            <Paragraph
              className="form-section-label"
              typography="t7"
              color={LABEL_INK}
            >
              제목
            </Paragraph>
            <span className="write-form-date">
              {/* Without this the date is announced as a bare number string
                  now that the visible "날짜" label is gone. */}
              <span className="visually-hidden">날짜 </span>
              {formatDateValue(draft.date)}
            </span>
          </div>
          <div
            className={
              titleLimitShakeCount > 0
                ? `diary-field-control limit-reached-shake-${titleLimitShakeCount % 2}`
                : "diary-field-control"
            }
          >
            <TextField
              variant="line"
              aria-label="제목"
              aria-describedby="title-character-status"
              placeholder="오늘의 제목을 지어주세요"
              maxLength={TITLE_MAX_LENGTH}
              value={draft.title}
              hasError={titleBlank}
              help={titleBlank ? "공백 말고 제목을 입력해 주세요" : undefined}
              onChange={(event) => handleTitleChange(event.target.value)}
            />
            <div
              id="title-character-status"
              className={`diary-character-status diary-character-status-title${
                titleAtLimit ? " diary-character-status-complete" : ""
              }`}
              aria-live="polite"
            >
              <strong>
                {titleLength}/{TITLE_MAX_LENGTH}
              </strong>
            </div>
          </div>
        </section>

        <section className="diary-form-section diary-weather-section">
          <Paragraph
            className="form-section-label"
            typography="t7"
            color={LABEL_INK}
          >
            날씨와 배경
          </Paragraph>
          <div className="time-theme-row">
            <span className="time-theme-label">배경 분위기</span>
            <div
              className="time-theme-options"
              role="radiogroup"
              aria-label="배경 분위기"
            >
              {(["day", "night"] as const).map((timeOfDay) => {
                const isSelected = draft.timeOfDay === timeOfDay;
                const isDay = timeOfDay === "day";
                return (
                  <button
                    key={timeOfDay}
                    type="button"
                    className={`time-theme-option${isSelected ? " is-selected" : ""}`}
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onChange({ timeOfDay })}
                  >
                    <img
                      className="time-theme-icon"
                      src={isDay ? "/weather/day.webp" : "/weather/night.webp"}
                      alt=""
                      aria-hidden="true"
                    />
                    {isDay ? "낮" : "밤"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="weather-options" role="radiogroup" aria-label="날씨">
            {WEATHER_OPTIONS.map((option) => {
              const isSelected = draft.weather === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`weather-option${isSelected ? " is-selected" : ""}`}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() =>
                    onChange({ weather: option.value as WeatherValue })
                  }
                >
                  <img
                    className="weather-option-icon"
                    src={option.iconUrl}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="weather-option-label">{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="diary-form-section diary-content-section">
          <Paragraph
            className="form-section-label"
            typography="t7"
            color={LABEL_INK}
          >
            일기
          </Paragraph>
          <div
            className={
              contentLimitShakeCount > 0
                ? `diary-field-control limit-reached-shake-${contentLimitShakeCount % 2}`
                : "diary-field-control"
            }
          >
            {/* Height is four 32px ruled bands plus 10px vertical padding.
                The CSS min/max
                height are !important and win regardless, but an off-grid
                number here would read as the intended size and invite a "fix". */}
            <TextArea
              variant="line"
              aria-label="일기"
              aria-describedby="diary-character-status"
              placeholder="오늘의 이야기를 적어주세요"
              height={170}
              maxLength={CONTENT_MAX_LENGTH}
              value={draft.content}
              onFocus={(event) => {
                const textarea = event.currentTarget;
                window.setTimeout(() => {
                  if (document.activeElement !== textarea) {
                    return;
                  }
                  textarea.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }, 300);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  draft.content.split("\n").length >= CONTENT_MAX_LINES
                ) {
                  event.preventDefault();
                }
              }}
              onChange={(event) =>
                handleContentChange(event.target.value, event.currentTarget)
              }
            />
            <div
              id="diary-character-status"
              className={`diary-character-status diary-character-status-content${
                contentAtLimit ? " diary-character-status-complete" : ""
              }`}
              aria-live="polite"
            >
              <strong>
                {contentLength}/{CONTENT_MAX_LENGTH}
              </strong>
            </div>
          </div>
        </section>
      </div>
      <div
        ref={endAnchorRef}
        className="write-form-end-anchor"
        aria-hidden="true"
      />
    </div>
  );
}
