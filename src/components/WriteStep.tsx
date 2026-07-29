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
  const handleContentChange = (value: string) => {
    const limitedContent = Array.from(value)
      .slice(0, CONTENT_MAX_LENGTH)
      .join("");

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
          </div>
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
                  {option.value !== "unknown" && (
                    <img
                      className="weather-option-icon"
                      src={option.iconUrl}
                      alt=""
                      aria-hidden="true"
                    />
                  )}
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
              height={138}
              maxLength={CONTENT_MAX_LENGTH}
              value={draft.content}
              onChange={(event) => handleContentChange(event.target.value)}
            />
          </div>
          <div
            id="diary-character-status"
            className={`diary-character-status${
              contentAtLimit ? " diary-character-status-complete" : ""
            }`}
            aria-live="polite"
          >
            {contentAtLimit && <span>멋진 여름 이야기가 가득 찼어요</span>}
            <strong>
              {contentLength}/{CONTENT_MAX_LENGTH}
            </strong>
          </div>
        </section>
      </div>
    </div>
  );
}
