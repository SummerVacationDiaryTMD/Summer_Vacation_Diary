import {
  AI_CONTENT_WATERMARK,
  weatherIconUrl,
  weatherLabel,
} from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import type { DiaryAnalysis } from "../services/diaryAnalysis";
import {
  CORRECTION_MARK_URLS,
  pickCorrectionMarkAsset,
} from "./correctionMarks";
import {
  DIARY_COMMENT,
  DIARY_FRAME,
  getDiaryFrameLayout,
  type DiaryFrameLayout,
} from "./diaryFrameLayout";
import {
  handwritingVariation,
  TITLE_HANDWRITING_STRENGTH,
} from "./handwriting";
import { buildHighlightSegments } from "./highlight";
import { ImageProcessError, loadImageFromDataUrl } from "./image";
import { drawTextMosaic } from "./mosaic";
import { findProfanityMatches } from "./profanity";
import { buildProfanityCorrectionRuns } from "./profanityCorrection";
import { STAMP_IMAGE_URLS } from "../constants/stamp";
import {
  buildStarPlacements,
  pickStarMarkAsset,
  STAR_MARK_URLS,
} from "./starMarks";

export interface DiaryImageInput {
  imageDataUrl: string;
  title: string;
  content: string;
  /** YYYY-MM-DD */
  date: string;
  weather: WeatherValue;
  analysis: DiaryAnalysis | null;
  includesAiGeneratedContent: boolean;
  profanityMosaicEnabled: boolean;
  profanityUnderlineEnabled: boolean;
  profanityTeacherNoteEnabled: boolean;
}

export interface ComposedDiaryImage {
  dataUrl: string;
  frameLayout: DiaryFrameLayout;
}

// The export and preview both use diaryFrameLayout's source-pixel coordinates,
// so an added manuscript row moves the footer by the same amount in both.
const WIDTH = DIARY_FRAME.width;
const TEMPLATE_URL = "/picture-diary-frame-instagram.png";

const HEADER = DIARY_FRAME.header;
const TITLE = DIARY_FRAME.title;
const PHOTO = DIARY_FRAME.photo;

const COLUMN_COUNT = DIARY_FRAME.columns;
const DIARY_FONT_FAMILY = '"NanumCoDingHeuiMang"';
const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const DIARY_FONT_STACK = `${DIARY_FONT_FAMILY}, ${SYSTEM_FONT_STACK}`;
const TEACHER_COMMENT_FONT_FAMILY = '"NanumDdarEGeEomMaGa"';
const TEACHER_COMMENT_FONT_STACK = `${TEACHER_COMMENT_FONT_FAMILY}, ${SYSTEM_FONT_STACK}`;

// 미리보기의 12/14/10px 등을 1058px 템플릿 원본 비율로 환산한 값입니다.
const HEADER_FONT_SIZE = 54;
const TITLE_FONT_SIZE = 45;
const HEADER_FONT = `400 ${HEADER_FONT_SIZE}px ${DIARY_FONT_STACK}`;
const TITLE_FONT = `400 ${TITLE_FONT_SIZE}px ${DIARY_FONT_STACK}`;
const CONTENT_FONT_SIZE = 54;
const CONTENT_FONT = `400 ${CONTENT_FONT_SIZE}px ${DIARY_FONT_STACK}`;
const COMMENT_LABEL_FONT = `700 18px ${SYSTEM_FONT_STACK}`;
const COMMENT_FONT = `700 48.96px ${TEACHER_COMMENT_FONT_STACK}`;
const AI_WATERMARK_FONT = `700 22px ${SYSTEM_FONT_STACK}`;
// Kept in sync with .ai-content-watermark's 5% right inset (1058px × 5%).
const AI_WATERMARK_RIGHT_INSET = 53;

const TEXT_COLOR = "#333333";
const COMMENT_COLOR = "#6b5e3f";
const LABEL_COLOR = "#806d3d";
const AI_WATERMARK_COLOR = "#8B6A3E";

interface DiaryCell {
  text: string;
  mark: "circle" | "underline" | "both" | null;
  isProfanity: boolean;
  profanityMatchIndex: number | null;
}

interface CorrectionRun {
  mark: "circle" | "underline";
  row: number;
  startColumn: number;
  length: number;
}

function fontWithWeight(font: string, weight: number): string {
  return /^(?:normal|bold|[1-9]00)\s/.test(font)
    ? font.replace(/^(?:normal|bold|[1-9]00)/, String(weight))
    : `${weight} ${font}`;
}

// 미리보기의 HandwrittenText와 같은 순서·seed·strength를 사용합니다.
function drawHandwrittenText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  startIndex: number,
  strength = 1,
  letterSpacing = 0,
  varyScale = true,
): number {
  let cursorX = x;
  let characterIndex = startIndex;

  for (const character of Array.from(text)) {
    const width = context.measureText(character).width;
    const variation = handwritingVariation(character, characterIndex, strength);
    const fontSize = Number(context.font.match(/([\d.]+)px/)?.[1] ?? 34);

    context.save();
    context.font = fontWithWeight(context.font, variation.fontWeight);
    context.globalAlpha *= variation.opacity;
    context.translate(
      cursorX + width / 2 + variation.offsetXEm * fontSize,
      baseline + variation.offsetYEm * fontSize,
    );
    context.rotate((variation.rotationDeg * Math.PI) / 180);
    const characterScale = varyScale ? variation.scale : 1;
    context.scale(characterScale, characterScale);
    context.fillText(character, -width / 2, 0);
    context.restore();

    cursorX += width + letterSpacing;
    characterIndex += 1;
  }

  return characterIndex;
}

function drawFittedHandwrittenText(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baseline: number,
  maxWidth: number,
  startIndex: number,
): void {
  const tracking = 3;
  const characterCount = Array.from(text).length;
  const textWidth =
    context.measureText(text).width +
    Math.max(0, characterCount - 1) * tracking;
  const scaleX = textWidth > 0 ? Math.min(1, maxWidth / textWidth) : 1;

  context.save();
  context.translate(centerX, 0);
  context.scale(scaleX, 1);
  let cursorX = -textWidth / 2;
  Array.from(text).forEach((character, index) => {
    drawHandwrittenText(
      context,
      character,
      cursorX,
      baseline,
      startIndex + index,
      0.45,
    );
    cursorX += context.measureText(character).width + tracking;
  });
  context.restore();
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  // CSS object-fit: cover와 동일하게 중앙을 기준으로 넘치는 부분을 자릅니다.
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function buildDiaryCells(
  content: string,
  analysis: DiaryAnalysis | null,
  rowCount: number,
  profanityEffectsEnabled: boolean,
): DiaryCell[] {
  const segments =
    analysis === null
      ? [{ text: content, mark: null }]
      : buildHighlightSegments(
          content,
          analysis.highlightWords,
          analysis.highlightSentence,
        );
  const cells: DiaryCell[] = [];
  const profanityMatches = profanityEffectsEnabled
    ? findProfanityMatches(content)
    : [];
  const profanityMatchBySourceIndex = new Map<number, number>();
  profanityMatches.forEach((match, matchIndex) => {
    for (
      let matchedSourceIndex = match.start;
      matchedSourceIndex <= match.end;
      matchedSourceIndex += 1
    ) {
      profanityMatchBySourceIndex.set(matchedSourceIndex, matchIndex);
    }
  });
  let sourceIndex = 0;

  for (const segment of segments) {
    for (const character of Array.from(segment.text)) {
      if (character === "\n") {
        while (cells.length % COLUMN_COUNT !== 0) {
          cells.push({
            text: "",
            mark: null,
            isProfanity: false,
            profanityMatchIndex: null,
          });
        }
        sourceIndex += 1;
      } else {
        const profanityMatchIndex =
          profanityMatchBySourceIndex.get(sourceIndex) ?? null;
        cells.push({
          text: character,
          mark: segment.mark,
          isProfanity: profanityMatchIndex !== null,
          profanityMatchIndex,
        });
        sourceIndex += 1;
      }
    }
  }

  return cells.slice(0, COLUMN_COUNT * rowCount);
}

function buildCorrectionRuns(cells: DiaryCell[]): CorrectionRun[] {
  const runs: CorrectionRun[] = [];
  (["circle", "underline"] as const).forEach((mark) => {
    cells.forEach((cell, index) => {
      if (cell.isProfanity || (cell.mark !== mark && cell.mark !== "both")) {
        return;
      }
      const row = Math.floor(index / COLUMN_COUNT);
      const column = index % COLUMN_COUNT;
      const previous = runs[runs.length - 1];
      if (
        previous !== undefined &&
        previous.mark === mark &&
        previous.row === row &&
        previous.startColumn + previous.length === column
      ) {
        previous.length += 1;
      } else {
        runs.push({ mark, row, startColumn: column, length: 1 });
      }
    });
  });
  return runs;
}

function drawPenPath(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  lineWidth: number,
) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  const passes = [
    { alpha: 0.84, width: 0.74, offset: 0, color: "#c83f3a" },
    { alpha: 0.3, width: 0.32, offset: 0.18, color: "#a92f2d" },
    { alpha: 0.22, width: 0.2, offset: -0.16, color: "#e1695d" },
  ];
  for (const pass of passes) {
    context.strokeStyle = pass.color;
    context.globalAlpha = pass.alpha;
    context.lineWidth = lineWidth * pass.width;
    context.beginPath();
    points.forEach(([pointX, pointY], index) => {
      const offset = lineWidth * pass.offset;
      if (index === 0) {
        context.moveTo(pointX, pointY + offset);
      } else {
        context.lineTo(pointX, pointY + offset);
      }
    });
    context.stroke();
  }
  context.restore();
}

function drawContent(
  context: CanvasRenderingContext2D,
  content: string,
  analysis: DiaryAnalysis | null,
  profanityMosaicEnabled: boolean,
  profanityUnderlineEnabled: boolean,
  profanityTeacherNoteEnabled: boolean,
  markImages: Map<string, HTMLImageElement>,
) {
  const layout = getDiaryFrameLayout(content);
  const { x, y, width, height } = layout.content;
  const cellWidth = width / COLUMN_COUNT;
  const cellHeight = height / layout.contentRows;
  const profanityEffectsEnabled =
    profanityMosaicEnabled ||
    profanityUnderlineEnabled ||
    profanityTeacherNoteEnabled;
  const cells = buildDiaryCells(
    content,
    analysis,
    layout.contentRows,
    profanityEffectsEnabled,
  );

  context.font = CONTENT_FONT;
  context.fillStyle = TEXT_COLOR;
  context.textAlign = "center";
  cells.forEach((cell, index) => {
    if (cell.text === "") return;
    const row = Math.floor(index / COLUMN_COUNT);
    const column = index % COLUMN_COUNT;
    if (cell.isProfanity && profanityMosaicEnabled) {
      const insetX = cellWidth * 0.12;
      const insetY = cellHeight * 0.19;
      drawTextMosaic(
        context,
        cell.text,
        x + column * cellWidth + insetX,
        y + row * cellHeight + insetY,
        cellWidth - insetX * 2,
        cellHeight - insetY * 2,
        { fontFamily: DIARY_FONT_STACK, seed: index },
      );
      return;
    }
    const centerX = x + (column + 0.5) * cellWidth;
    const baseline = y + (row + 0.5) * cellHeight + 18;
    const variation = handwritingVariation(cell.text, index, 1);

    context.save();
    context.font = fontWithWeight(context.font, variation.fontWeight);
    context.globalAlpha *= variation.opacity;
    context.translate(
      centerX + variation.offsetXEm * CONTENT_FONT_SIZE,
      baseline + variation.offsetYEm * CONTENT_FONT_SIZE,
    );
    context.rotate((variation.rotationDeg * Math.PI) / 180);
    context.scale(variation.scale, variation.scale);
    context.fillText(cell.text === " " ? "\u00a0" : cell.text, 0, 0);
    context.restore();
  });
  context.textAlign = "start";

  // 미리보기와 동일하게 연속된 첨삭 구간을 한 개의 표시로 묶습니다.
  // 크기/위치 비율(88%, 16%, 5%)은 App.css의 .diary-correction-* 값과
  // 맞춰져 있습니다 — 한쪽만 바꾸면 미리보기와 저장본이 어긋납니다.
  for (const run of buildCorrectionRuns(cells)) {
    const runX = x + run.startColumn * cellWidth;
    const runY = y + run.row * cellHeight;
    const runWidth = run.length * cellWidth;
    const markImage = markImages.get(
      pickCorrectionMarkAsset(run.mark, run.row, run.startColumn, run.length),
    );
    if (markImage === undefined) continue;
    if (run.mark === "circle") {
      context.drawImage(
        markImage,
        runX,
        runY + cellHeight * 0.06,
        runWidth,
        cellHeight * 0.88,
      );
    } else {
      const lineHeight = cellHeight * 0.16;
      context.drawImage(
        markImage,
        runX,
        runY + cellHeight - lineHeight - cellHeight * 0.05,
        runWidth,
        lineHeight,
      );
    }
  }

  const starPlacements =
    analysis === null
      ? []
      : buildStarPlacements(
          content,
          analysis.starWords,
          COLUMN_COUNT,
          COLUMN_COUNT * layout.contentRows,
        ).filter(({ row, column }) => {
          const cell = cells[row * COLUMN_COUNT + column];
          return cell !== undefined && !cell.isProfanity;
        });

  for (const placement of starPlacements) {
    const starImage = markImages.get(
      pickStarMarkAsset(placement.row, placement.column),
    );
    if (starImage === undefined) continue;

    const size = Math.min(cellWidth, cellHeight) * 0.84;
    const cellX = x + placement.column * cellWidth;
    const cellY = y + placement.row * cellHeight;
    // Stars may cross manuscript cells and region lines, but the complete
    // drawing must remain inside the exported 4:5 image.
    const starX = Math.min(
      Math.max(cellX - size * 0.28, 0),
      layout.width - size,
    );
    const starY = Math.min(
      Math.max(cellY - size * 0.22, 0),
      layout.height - size,
    );
    context.drawImage(starImage, starX, starY, size, size);
  }

  context.font = `700 22px ${TEACHER_COMMENT_FONT_STACK}`;
  context.fillStyle = "#d24b42";
  context.textBaseline = "alphabetic";
  for (const run of buildProfanityCorrectionRuns(cells, COLUMN_COUNT)) {
    const runX = x + run.startColumn * cellWidth;
    const runY = y + run.row * cellHeight;
    const runWidth = run.length * cellWidth;
    if (profanityUnderlineEnabled) {
      const markX = runX - cellWidth * 0.05;
      const markWidth = runWidth + cellWidth * 0.1;
      if (
        run.decoration === "underline" ||
        run.decoration === "double-underline"
      ) {
        const lineImage = markImages.get(
          pickCorrectionMarkAsset(
            "underline",
            run.row,
            run.startColumn,
            run.length,
          ),
        );
        if (lineImage !== undefined) {
          const lineYs =
            run.decoration === "double-underline" ? [0.32, 0.53] : [0.42];
          lineYs.forEach((lineY) => {
            context.drawImage(
              lineImage,
              markX,
              runY + cellHeight * lineY,
              markWidth,
              cellHeight * 0.16,
            );
          });
        }
      } else if (run.decoration === "cross") {
        const top = runY + cellHeight * 0.22;
        const bottom = runY + cellHeight * 0.72;
        drawPenPath(
          context,
          [
            [markX, top],
            [markX + markWidth * 0.48, runY + cellHeight * 0.45],
            [markX + markWidth, bottom],
          ],
          cellHeight * 0.052,
        );
        drawPenPath(
          context,
          [
            [markX, bottom],
            [markX + markWidth * 0.52, runY + cellHeight * 0.43],
            [markX + markWidth, top],
          ],
          cellHeight * 0.052,
        );
      } else {
        drawPenPath(
          context,
          [
            [markX + markWidth * 0.08, runY + cellHeight * 0.5],
            [markX + markWidth * 0.2, runY + cellHeight * 0.59],
            [markX + markWidth * 0.34, runY + cellHeight * 0.7],
            [markX + markWidth * 0.62, runY + cellHeight * 0.44],
            [markX + markWidth * 0.92, runY + cellHeight * 0.2],
          ],
          cellHeight * 0.058,
        );
      }
    }

    if (!profanityTeacherNoteEnabled || !run.showMessage) continue;
    const measuredWidth = context.measureText(run.message).width;
    const maxNoteX = Math.max(x, x + width - measuredWidth);
    const noteX = Math.min(Math.max(x, runX), maxNoteX);
    context.save();
    context.translate(noteX, runY + cellHeight * 0.78);
    context.rotate(
      (((run.row + run.startColumn) % 2 === 0 ? -3 : 2) * Math.PI) / 180,
    );
    context.fillText(run.message, 0, 0);
    context.restore();
  }
  context.textBaseline = "alphabetic";
}

function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(x, y, width, height, radius);
  } else {
    context.rect(x, y, width, height);
  }
}

function drawAiContentWatermark(context: CanvasRenderingContext2D) {
  context.save();

  context.font = AI_WATERMARK_FONT;
  context.textBaseline = "middle";

  const paddingX = 20;
  const height = 42;
  const width = context.measureText(AI_CONTENT_WATERMARK).width + paddingX * 2;

  const x = WIDTH - AI_WATERMARK_RIGHT_INSET - width;
  const y = TITLE.y + (TITLE.height - height) / 2;

  // 부드러운 그림자
  context.shadowColor = "rgba(70, 60, 45, 0.08)";
  context.shadowBlur = 8;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 2;

  // 배경
  context.fillStyle = "rgba(255, 252, 245, 0.94)";

  // 테두리
  context.strokeStyle = "rgba(176, 148, 108, 0.38)";
  context.lineWidth = 2;

  roundRectPath(context, x, y, width, height, height / 2);
  context.fill();
  context.stroke();

  // 텍스트에는 그림자 제거
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;

  // 상수 유지
  context.fillStyle = AI_WATERMARK_COLOR;
  context.fillText(AI_CONTENT_WATERMARK, x + paddingX, y + height / 2 + 1);

  context.restore();
}

function drawComment(
  context: CanvasRenderingContext2D,
  analysis: DiaryAnalysis | null,
  layout: DiaryFrameLayout,
  commentLines: string[],
) {
  if (analysis === null) return;
  const { x, y, width, height } = layout.comment;
  const paddingX = DIARY_COMMENT.paddingX;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();

  context.font = COMMENT_LABEL_FONT;
  context.fillStyle = LABEL_COLOR;
  context.fillText("선생님 한마디", x + paddingX, y + 27);

  // 미리보기의 12px 한 줄 문장을 원본 템플릿 비율로 환산한 30px입니다.
  context.font = COMMENT_FONT;
  context.fillStyle = COMMENT_COLOR;
  const commentLineHeight = DIARY_COMMENT.lineHeight;
  commentLines.forEach((line, index) => {
    context.fillText(line, x + paddingX, y + 82 + index * commentLineHeight);
  });

  context.restore();
}
function drawStamp(
  context: CanvasRenderingContext2D,
  stampImage: HTMLImageElement,
  layout: DiaryFrameLayout,
) {
  const stampWidth = layout.width * 0.2;

  const aspectRatio =
    stampImage.naturalWidth > 0
      ? stampImage.naturalHeight / stampImage.naturalWidth
      : 1;

  const stampHeight = stampWidth * aspectRatio;

  // CSS의 right: 3.5%
  const rightOffset = layout.width * 0.035;

  // CSS의 bottom: 11%
  const bottomOffset = layout.height * 0.11;

  const centerX = layout.width - rightOffset - stampWidth / 2;

  const centerY = layout.height - bottomOffset - stampHeight / 2;

  context.save();

  context.translate(centerX, centerY);
  context.rotate((-35 * Math.PI) / 180);

  context.globalAlpha = 0.75;

  context.drawImage(
    stampImage,
    -stampWidth / 2,
    -stampHeight / 2,
    stampWidth,
    stampHeight,
  );

  context.restore();
}

function wrapCommentToFrame(
  context: CanvasRenderingContext2D,
  comment: string,
): string[] {
  const maxWidth = DIARY_FRAME.comment.width - DIARY_COMMENT.paddingX * 2;
  const ellipsis = "…";
  let fitted = "";

  for (const character of Array.from(comment.trim())) {
    const candidate = fitted + character;
    if (fitted !== "" && context.measureText(candidate).width > maxWidth) {
      while (
        fitted !== "" &&
        context.measureText(fitted + ellipsis).width > maxWidth
      ) {
        fitted = Array.from(fitted).slice(0, -1).join("");
      }
      return [`${fitted}${ellipsis}`];
    }
    fitted = candidate;
  }

  return [fitted];
}

function drawFrameTemplate(
  context: CanvasRenderingContext2D,
  template: HTMLImageElement,
  layout: DiaryFrameLayout,
) {
  context.drawImage(template, 0, 0, WIDTH, layout.height);
}

export async function composeDiaryImage(
  input: DiaryImageInput,
): Promise<ComposedDiaryImage> {
  const stampImagePromise =
    input.analysis === null
      ? Promise.resolve<HTMLImageElement | null>(null)
      : loadImageFromDataUrl(STAMP_IMAGE_URLS[input.analysis.stamp]);

  const [image, template, weatherIcon, stampImage] = await Promise.all([
    loadImageFromDataUrl(input.imageDataUrl),
    loadImageFromDataUrl(TEMPLATE_URL),
    loadImageFromDataUrl(weatherIconUrl(input.weather)),
    stampImagePromise,
  ]);

  // 손그림 첨삭 에셋은 분석 결과가 있을 때만 필요합니다. 8장 전부를
  // 미리 받아두는 이유: drawContent는 동기 함수라 그리는 도중에는
  // 로드를 기다릴 수 없기 때문입니다 (번들 내 로컬 파일이라 비용은 미미).
  const markImages = new Map<string, HTMLImageElement>();
  if (input.analysis !== null) {
    await Promise.all(
      [...CORRECTION_MARK_URLS, ...STAR_MARK_URLS].map(async (url) => {
        markImages.set(url, await loadImageFromDataUrl(url));
      }),
    );
  }

  try {
    await Promise.all([
      document.fonts.load(`34px ${DIARY_FONT_FAMILY}`),
      document.fonts.load(`30px ${TEACHER_COMMENT_FONT_FAMILY}`),
    ]);
  } catch {
    // 폰트를 못 읽어도 시스템 폰트 fallback으로 저장은 계속합니다.
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageProcessError("load-failed");

  // 배경 프레임의 실제 한마디 칸(좌우 25px 안쪽)과 로드된 글꼴의
  // 측정 폭으로 줄을 나눕니다. 글자 수 추정은 여백이 남아도 조기
  // 줄바꿈될 수 있어 저장 이미지와 프레임 칸이 어긋납니다.
  context.font = COMMENT_FONT;
  const commentLines =
    input.analysis === null
      ? [""]
      : wrapCommentToFrame(context, input.analysis.comment);
  const frameLayout = getDiaryFrameLayout(input.content, commentLines.length);

  canvas.height = frameLayout.height;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.textBaseline = "alphabetic";

  // DOM 미리보기와 같은 순서: 템플릿 → 사진 → 글자/첨삭 → 한마디/태그.
  drawFrameTemplate(context, template, frameLayout);
  drawCoverImage(context, image, PHOTO.x, PHOTO.y, PHOTO.width, PHOTO.height);

  const [year = "", month = "", day = ""] = input.date.split("-");
  const diaryDate = new Date(`${input.date}T00:00:00`);
  const weekday = Number.isNaN(diaryDate.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(diaryDate);
  const headerX = HEADER.x;
  const headerY = HEADER.y;
  const headerWidth = HEADER.width;
  const headerHeight = HEADER.height;
  const headerBaseline = headerY + headerHeight * 0.5 + 18;
  const headerItems = [
    { text: year, left: 0.065, maxWidth: 125, seed: 0 },
    {
      text: String(Number(month)).padStart(2, "0"),
      left: 0.237,
      maxWidth: 72,
      seed: 10,
    },
    {
      text: String(Number(day)).padStart(2, "0"),
      left: 0.364,
      maxWidth: 72,
      seed: 20,
    },
    { text: weekday, left: 0.525, maxWidth: 76, seed: 30 },
  ];

  context.font = HEADER_FONT;
  context.fillStyle = "#222222";
  context.textAlign = "center";
  for (const item of headerItems) {
    drawFittedHandwrittenText(
      context,
      item.text,
      headerX + headerWidth * item.left,
      headerBaseline,
      item.maxWidth,
      item.seed,
    );
  }
  // 4.6cqw in the DOM preview maps to about 49 source pixels at 1058px wide.
  // Keeping the export at the same source ratio makes both versions match.
  const weatherIconSize = 56;
  const weatherIconX = headerX + headerWidth * 0.755;
  context.drawImage(
    weatherIcon,
    weatherIconX,
    headerY + (headerHeight - weatherIconSize) / 2,
    weatherIconSize,
    weatherIconSize,
  );
  const weatherText = weatherLabel(input.weather);
  const weatherTextLeft = weatherIconX + weatherIconSize + 10;
  const weatherTextRight = headerX + headerWidth - 8;
  drawFittedHandwrittenText(
    context,
    weatherText,
    (weatherTextLeft + weatherTextRight) / 2,
    headerBaseline,
    weatherTextRight - weatherTextLeft,
    40,
  );
  context.textAlign = "start";

  const titleX = TITLE.x;
  const titleY = TITLE.y;
  const titleWidth = TITLE.width;
  const titleHeight = TITLE.height;
  context.save();
  context.beginPath();
  context.rect(titleX, titleY, titleWidth, titleHeight);
  context.clip();
  context.font = TITLE_FONT;
  context.fillStyle = "#222222";
  const titleText = input.title || "제목 없는 일기";
  const titleTracking = 4;
  drawHandwrittenText(
    context,
    titleText,
    titleX,
    titleY + titleHeight / 2 + 12,
    50,
    TITLE_HANDWRITING_STRENGTH,
    titleTracking,
  );
  context.restore();

  drawContent(
    context,
    input.content,
    input.analysis,
    input.profanityMosaicEnabled,
    input.profanityUnderlineEnabled,
    input.profanityTeacherNoteEnabled,
    markImages,
  );
  drawComment(context, input.analysis, frameLayout, commentLines);

  if (stampImage !== null) {
    drawStamp(context, stampImage, frameLayout);
  }

  if (input.includesAiGeneratedContent) {
    drawAiContentWatermark(context);
  }

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    frameLayout,
  };
}
