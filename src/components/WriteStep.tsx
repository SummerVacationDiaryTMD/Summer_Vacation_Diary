import { Paragraph, TextArea, TextField } from "@toss/tds-mobile";
import { useState } from "react";

import {
  CONTENT_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  WEATHER_OPTIONS,
} from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import type { DiaryDraft } from "../hooks/useDiaryDraft";

interface WriteStepProps {
  draft: DiaryDraft;
  onChange: (patch: Partial<DiaryDraft>) => void;
}

// The form sits on a permanently cream sheet, so an adaptive token here would
// resolve to a near-white ink in dark mode. Fixed, like the date input's color.
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
 * Step 2: title, diary text, date and weather.
 * All fields write straight into the shared draft, so leaving this screen
 * (or the app) never loses input — the draft hook persists it.
 */
export function WriteStep({ draft, onChange }: WriteStepProps) {
  const [titleLimitShakeCount, setTitleLimitShakeCount] = useState(0);
  const [contentLimitShakeCount, setContentLimitShakeCount] = useState(0);
  const titleLength = Array.from(draft.title).length;
  const titleAtLimit = titleLength >= TITLE_MAX_LENGTH;
  const contentLength = Array.from(draft.content).length;
  const selectedWeather =
    WEATHER_OPTIONS.find((option) => option.value === draft.weather) ??
    WEATHER_OPTIONS[0];
  const handleContentChange = (value: string, element: HTMLTextAreaElement) => {
    const limitedContent = Array.from(
      value.split("\n").slice(0, CONTENT_MAX_LINES).join("\n"),
    )
      .slice(0, CONTENT_MAX_LENGTH)
      .join("");

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

  return (
    <div className="step-body write-form">
      <div className="write-form-surface">
        <section className="diary-form-section diary-title-section">
          <Paragraph
            className="form-section-label"
            typography="t7"
            color={LABEL_INK}
          >
            제목
          </Paragraph>
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

        <section className="diary-form-section diary-date-section">
          <Paragraph
            className="form-section-label"
            typography="t7"
            color={LABEL_INK}
          >
            날짜
          </Paragraph>
          {/* Native date input: the OS date picker on mobile beats any custom
              calendar for effort-to-quality, and TDS has no date picker widget. */}
          <div className="date-input-wrap">
            <span className="date-input-value" aria-hidden="true">
              {formatDateValue(draft.date)}
            </span>
            <input
              className="date-input"
              type="date"
              aria-label="일기 날짜"
              value={draft.date}
              // Without this only the calendar glyph opens the picker — tapping
              // the date text does nothing, which reads as a dead button.
              // showPicker is Chrome 99+/Safari 16+ and throws if it is not
              // user-activated or unsupported, so a failure just leaves the
              // native behaviour in place.
              onClick={(event) => {
                try {
                  event.currentTarget.showPicker();
                } catch {
                  // Older WebView: the indicator still works.
                }
              }}
              onChange={(event) => {
                // Some browsers emit an empty string while the picker is being
                // cleared; keep the previous date instead of storing an invalid one.
                if (event.target.value !== "") {
                  onChange({ date: event.target.value });
                }
              }}
            />
          </div>
        </section>

        <section className="diary-form-section diary-weather-section">
          <Paragraph
            className="form-section-label"
            typography="t7"
            color={LABEL_INK}
          >
            날씨
          </Paragraph>
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
          <button
            key={`${draft.weather}-${draft.timeOfDay}`}
            type="button"
            className={`weather-theme-preview preview-${draft.timeOfDay} preview-weather-${draft.weather}`}
            aria-label={`${selectedWeather.label} ${draft.timeOfDay === "day" ? "낮" : "밤"} 배경을 화면 위에서 확인하기`}
            onClick={() => {
              const reduceMotion = window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches;
              window.scrollTo({
                top: 0,
                behavior: reduceMotion ? "auto" : "smooth",
              });
            }}
          >
            <div className="weather-theme-preview-sky" aria-hidden="true">
              <img
                className="weather-theme-preview-weather"
                src={selectedWeather.iconUrl}
                alt=""
              />
              <img
                className="weather-theme-preview-time"
                src={
                  draft.timeOfDay === "day"
                    ? "/weather/day.webp"
                    : "/weather/night.webp"
                }
                alt=""
              />
            </div>
            <div className="weather-theme-preview-copy">
              <span>선택한 배경</span>
              <strong>
                {selectedWeather.label} ·{" "}
                {draft.timeOfDay === "day" ? "낮" : "밤"}
              </strong>
              <small>상단 배경 보러 가기 ↑</small>
            </div>
          </button>
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
    </div>
  );
}
