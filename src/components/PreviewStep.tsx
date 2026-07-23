import { Button, Loader, Paragraph } from "@toss/tds-mobile";
import { useEffect, useState, type CSSProperties } from "react";

import { weatherIconUrl, weatherLabel } from "../constants/diary";
import { DiaryFrameBackground } from "./DiaryFrameBackground";
import type { AnalysisState } from "../hooks/useDiaryAnalysis";
import type { DiaryDraft } from "../hooks/useDiaryDraft";
import type { SketchState } from "../hooks/useSketch";
import { isAiConnected } from "../services/diaryAnalysis";
import type { DiaryAnalysis } from "../services/diaryAnalysis";
import { isSketchAiConnected } from "../services/styleTransfer";
import { isAiTestMode } from "../services/supabaseEdge";
import { buildDiaryTags, composeDiaryImage } from "../utils/diaryImage";
import {
  DIARY_FRAME,
  getDiaryFrameLayout,
  type DiaryFrameLayout,
  type DiaryFrameRegion,
} from "../utils/diaryFrameLayout";
import { handwritingVariation } from "../utils/handwriting";
import { buildHighlightSegments } from "../utils/highlight";

interface PreviewStepProps {
  draft: DiaryDraft;
  analysisState: AnalysisState;
  onRetry: () => void;
  sketchState: SketchState;
  onSketchRetry: () => void;
}

function frameRegionStyle(
  region: DiaryFrameRegion,
  layout: DiaryFrameLayout,
): CSSProperties {
  return {
    left: `${(region.x / layout.width) * 100}%`,
    top: `${(region.y / layout.height) * 100}%`,
    width: `${(region.width / layout.width) * 100}%`,
    height: `${(region.height / layout.height) * 100}%`,
  };
}

// 날짜/날씨/제목처럼 한 요소 안에 있는 문자열도 한 글자씩 나눠서
// 본문과 같은 고정된 손글씨 흔들림을 적용합니다.
function HandwrittenText({
  text,
  seedOffset = 0,
  strength = 1,
}: {
  text: string;
  seedOffset?: number;
  strength?: number;
}) {
  return Array.from(text).map((character, index) => {
    const variation = handwritingVariation(
      character,
      index + seedOffset,
      strength,
    );
    return (
      <span
        key={`${index}-${character}`}
        className="handwritten-character"
        style={{
          fontSize: `${variation.scale}em`,
          // 날짜/날씨/제목에도 글자별 굵기와 농도 차이를 적용합니다.
          fontWeight: variation.fontWeight,
          opacity: variation.opacity,
          transform: `translate(${variation.offsetXEm}em, ${variation.offsetYEm}em) rotate(${variation.rotationDeg}deg)`,
        }}
      >
        {character === " " ? "\u00a0" : character}
      </span>
    );
  });
}

// Renders the diary text onto an 11x5 manuscript grid, one character per cell.
// Correction marks (circle/underline) are drawn as an absolutely-positioned
// visual overlay. The overlay is aria-hidden, so these marks are NOT exposed
// to screen readers (visual-only for now).
function HighlightedContent({
  content,
  analysis,
}: {
  content: string;
  analysis: DiaryAnalysis | null;
}) {
  const columnCount = 11;
  const layout = getDiaryFrameLayout(content);
  const rowCount = layout.contentRows;
  const segments =
    analysis === null
      ? [{ text: content, mark: null }]
      : buildHighlightSegments(
          content,
          analysis.highlightWords,
          analysis.highlightSentence,
        );
  const cells: Array<{
    text: string;
    mark: "circle" | "underline" | null;
  }> = [];

  for (const segment of segments) {
    for (const character of Array.from(segment.text)) {
      if (character === "\n") {
        while (cells.length % columnCount !== 0) {
          cells.push({ text: "", mark: null });
        }
        continue;
      }
      cells.push({ text: character, mark: segment.mark });
    }
  }

  // Fill the five manuscript rows printed on the supplied diary frame.
  const visibleCellCount = Math.max(
    columnCount * rowCount,
    Math.ceil(cells.length / columnCount) * columnCount,
  );
  while (cells.length < visibleCellCount) {
    cells.push({ text: "", mark: null });
  }

  const correctionRuns: Array<{
    mark: "circle" | "underline";
    row: number;
    startColumn: number;
    length: number;
  }> = [];
  cells.slice(0, columnCount * rowCount).forEach((cell, index) => {
    if (cell.mark === null) {
      return;
    }
    const row = Math.floor(index / columnCount);
    const column = index % columnCount;
    const previous = correctionRuns[correctionRuns.length - 1];
    if (
      previous !== undefined &&
      previous.mark === cell.mark &&
      previous.row === row &&
      previous.startColumn + previous.length === column
    ) {
      previous.length += 1;
    } else {
      correctionRuns.push({
        mark: cell.mark,
        row,
        startColumn: column,
        length: 1,
      });
    }
  });

  return (
    <>
      {cells.slice(0, columnCount * rowCount).map((cell, index) => {
        // 본문도 날짜·날씨·제목과 동일한 기본 강도 1을 사용합니다.
        const variation = handwritingVariation(cell.text, index, 1);
        return (
          <span key={index} className="diary-grid-cell">
            <span
              className="diary-grid-character"
              style={{
                fontSize: `${variation.scale}em`,
                // 본문에도 같은 굵기와 농도 변화를 적용합니다.
                fontWeight: variation.fontWeight,
                opacity: variation.opacity,
                transform: `translate(${variation.offsetXEm}em, ${variation.offsetYEm}em) rotate(${variation.rotationDeg}deg)`,
              }}
            >
              {cell.text === " " ? "\u00a0" : cell.text}
            </span>
          </span>
        );
      })}
      <span className="diary-correction-layer" aria-hidden>
        {correctionRuns.map((run, index) => (
          <span
            key={index}
            className={`diary-correction diary-correction-${run.mark}`}
            style={{
              left: `${(run.startColumn / columnCount) * 100}%`,
              top: `${(run.row / rowCount) * 100}%`,
              width: `${(run.length / columnCount) * 100}%`,
              height: `${100 / rowCount}%`,
            }}
          />
        ))}
      </span>
    </>
  );
}

/**
 * Step 3: the diary card laid out per the spec's 기본 구성
 * (date/weather → photo → title → content → one-line comment).
 * Stage 2 fills the comment area with the real analysis result (comment +
 * tags + highlight marks); stage 3 swaps the photo for the pencil drawing,
 * with the original photo as the fallback while converting / on failure
 * (spec: "원본 사진으로 그림일기를 만들거나 다시 시도할 수 있습니다").
 */
export function PreviewStep({
  draft,
  analysisState,
  onRetry,
  sketchState,
  onSketchRetry,
}: PreviewStepProps) {
  const analysis =
    analysisState.status === "success" ? analysisState.analysis : null;

  const sketchUrl =
    sketchState.status === "success" && !isAiTestMode
      ? sketchState.sketchDataUrl
      : null;
  const showsSketch = sketchUrl !== null;
  const includesAiGeneratedContent =
    (isSketchAiConnected && sketchState.status === "success") ||
    (isAiConnected && analysisState.status === "success");
  const [renderedPreview, setRenderedPreview] = useState<string | null>(null);

  useEffect(() => {
    const imageDataUrl = draft.sketchDataUrl ?? draft.photoDataUrl;
    if (imageDataUrl === null) {
      setRenderedPreview(null);
      return;
    }

    let cancelled = false;
    setRenderedPreview(null);
    void composeDiaryImage({
      imageDataUrl,
      title: draft.title.trim() || "제목 없는 일기",
      content: draft.content,
      date: draft.date,
      weather: draft.weather,
      analysis,
      includesAiGeneratedContent,
    })
      .then((dataUrl) => {
        if (!cancelled) setRenderedPreview(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setRenderedPreview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [analysis, draft, includesAiGeneratedContent]);

  // Announced through the always-mounted live region below. A region that
  // mounts together with its text is often not read at all — only TEXT
  // CHANGES inside an existing region are reliably announced, which is
  // exactly what happens when loading flips to success mid-visit.
  const sketchAnnouncement =
    sketchState.status === "loading"
      ? "사진을 색연필 그림으로 바꾸고 있어요"
      : sketchState.status === "success"
        ? isAiTestMode
          ? "원본 사진으로 미리보기를 준비했어요"
          : "색연필 그림이 완성됐어요"
        : sketchState.status === "error"
          ? "그림 변환에 실패해서 원본 사진이 보여요"
          : "";
  // Shared with the saved-image renderer so the preview and the exported
  // diary always show the same tags.
  const tags = analysis === null ? [] : buildDiaryTags(analysis);
  const [year = "", month = "", day = ""] = draft.date.split("-");
  const diaryDate = new Date(`${draft.date}T00:00:00`);
  const weekday = Number.isNaN(diaryDate.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(diaryDate);
  const frameLayout = getDiaryFrameLayout(draft.content);

  return (
    <div className="step-body preview-step">
      <p className="visually-hidden" role="status">
        {sketchAnnouncement}
      </p>

      <div className="diary-card">
        <div
          className="diary-template"
          style={{
            aspectRatio: `${frameLayout.width} / ${frameLayout.height}`,
          }}
        >
          <DiaryFrameBackground layout={frameLayout} />

          {includesAiGeneratedContent && (
            <span
              className="ai-content-watermark"
              style={{ top: `${(106 / frameLayout.height) * 100}%` }}
            >
              AI 생성 콘텐츠 포함
            </span>
          )}

          <div
            className="diary-card-header"
            style={frameRegionStyle(DIARY_FRAME.header, frameLayout)}
          >
            <span>
              <strong>
                <HandwrittenText text={year} strength={0.45} />
              </strong>
            </span>
            <span>
              <strong>
                <HandwrittenText
                  text={String(Number(month))}
                  seedOffset={10}
                  strength={0.45}
                />
              </strong>
            </span>
            <span>
              <strong>
                <HandwrittenText
                  text={String(Number(day))}
                  seedOffset={20}
                  strength={0.45}
                />
              </strong>
            </span>
            <span>
              <strong>
                <HandwrittenText
                  text={weekday}
                  seedOffset={30}
                  strength={0.45}
                />
              </strong>
            </span>
            <span className="diary-weather">
              <img
                className="diary-weather-icon"
                src={weatherIconUrl(draft.weather)}
                alt=""
                aria-hidden="true"
              />
              <strong>
                <HandwrittenText
                  text={weatherLabel(draft.weather)}
                  seedOffset={40}
                  strength={0.45}
                />
              </strong>
            </span>
          </div>

          <div
            className="diary-title-row"
            style={frameRegionStyle(DIARY_FRAME.title, frameLayout)}
          >
            <strong>
              <HandwrittenText
                text={draft.title !== "" ? draft.title : "제목 없는 일기"}
                seedOffset={50}
              />
            </strong>
          </div>

          <div
            className="diary-card-photo"
            style={frameRegionStyle(DIARY_FRAME.photo, frameLayout)}
          >
            {draft.photoDataUrl !== null ? (
              <>
                <img
                  src={showsSketch ? sketchUrl : draft.photoDataUrl}
                  alt={
                    showsSketch ? "색연필 그림으로 바뀐 일기 사진" : "일기 사진"
                  }
                />
                {sketchState.status === "loading" && (
                  // aria-hidden: the persistent live region at the top of this
                  // component already announces the conversion; reading this
                  // overlay too would announce it twice.
                  <div className="sketch-overlay" aria-hidden>
                    <Loader size="small" />
                    <span>사진을 색연필 그림으로 바꾸고 있어요</span>
                  </div>
                )}
              </>
            ) : (
              <div className="diary-card-photo-empty">사진이 없어요</div>
            )}
          </div>

          <div
            className="diary-card-content"
            style={{
              ...frameRegionStyle(frameLayout.content, frameLayout),
              gridTemplateRows: `repeat(${frameLayout.contentRows}, minmax(0, 1fr))`,
            }}
          >
            <HighlightedContent content={draft.content} analysis={analysis} />
          </div>

          {/* Fixed colors throughout the card: it sits on a fixed paper
            background (#fffdf5), and the AIT provider is light-only today. */}
          <div
            className="diary-card-comment"
            style={frameRegionStyle(frameLayout.comment, frameLayout)}
          >
            <div className="diary-comment-label">선생님 한줄평</div>
            {analysisState.status === "loading" && (
              <div className="comment-loading">
                <Loader size="small" />
                <Paragraph
                  as="span"
                  className="diary-comment-text"
                  typography="t7"
                  color="#8a7d55"
                >
                  선생님이 일기를 읽고 있어요...
                </Paragraph>
              </div>
            )}

            {analysisState.status === "error" && (
              <div className="comment-error">
                <Paragraph
                  as="span"
                  className="diary-comment-text"
                  typography="t7"
                  color="#8a7d55"
                >
                  한줄평을 불러오지 못했어요
                </Paragraph>
              </div>
            )}

            {analysis !== null && (
              <>
                <Paragraph
                  className="diary-comment-text"
                  typography="t6"
                  fontWeight="medium"
                  color="#6b5e3f"
                >
                  ✏️ {analysis.comment}
                </Paragraph>
                {tags.length > 0 && (
                  <div className="diary-tags">
                    {tags.map((tag) => (
                      <span key={tag} className="diary-tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {renderedPreview !== null && (
            <img
              className="diary-rendered-preview"
              src={renderedPreview}
              alt="저장될 그림일기 미리보기"
            />
          )}
        </div>

        {analysisState.status === "error" && (
          <div className="preview-status-panel" role="alert">
            <Paragraph typography="t7" color="#6b5e3f">
              {analysisState.message}
            </Paragraph>
            <Button
              className="app-stable-button-state"
              size="small"
              variant="weak"
              color="dark"
              onClick={onRetry}
            >
              한줄평 다시 시도
            </Button>
          </div>
        )}

        {/* Keep mode guidance outside the fixed-ratio paper. Content placed in
            the printed comment box must scale with it and cannot grow freely. */}
        {(isAiTestMode || !isAiConnected) && (
          <div className="preview-mode-note">
            {isAiTestMode
              ? isAiConnected
                ? "테스트 모드 · 원본 사진으로 분석만 진행해요"
                : "테스트 모드 · 원본 사진과 예시 분석이 보여요"
              : "체험 모드 · 예시 분석과 간단한 그림 효과가 보여요"}
          </div>
        )}

        {sketchState.status === "error" && (
          <div className="sketch-error">
            <Paragraph typography="t7" color="#6b5e3f">
              {sketchState.message}
            </Paragraph>
            <div className="sketch-error-actions">
              <Paragraph as="span" typography="t7" color="#6b5e3f">
                원본 사진으로도 완성할 수 있어요
              </Paragraph>
              {sketchState.retryable && (
                <Button
                  className="app-stable-button-state"
                  size="small"
                  variant="weak"
                  color="dark"
                  onClick={onSketchRetry}
                >
                  다시 시도
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
