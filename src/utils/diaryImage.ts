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

export interface DiaryImageInput {
  imageDataUrl: string;
  title: string;
  content: string;
  /** YYYY-MM-DD */
  date: string;
  weather: WeatherValue;
  analysis: DiaryAnalysis | null;
  includesAiGeneratedContent: boolean;
}

export interface ComposedDiaryImage {
  dataUrl: string;
  frameLayout: DiaryFrameLayout;
}

// The export and preview both use diaryFrameLayout's source-pixel coordinates,
// so an added manuscript row moves the footer by the same amount in both.
const WIDTH = DIARY_FRAME.width;
const BASE_HEIGHT = DIARY_FRAME.baseHeight;
const TEMPLATE_URL = "/picture-diary-frame.png";

const HEADER = DIARY_FRAME.header;
const TITLE = DIARY_FRAME.title;
const PHOTO = DIARY_FRAME.photo;

const COLUMN_COUNT = 11;
const DIARY_FONT_FAMILY = '"NanumCoDingHeuiMang"';
const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const DIARY_FONT_STACK = `${DIARY_FONT_FAMILY}, ${SYSTEM_FONT_STACK}`;
const TEACHER_COMMENT_FONT_FAMILY = '"NanumDdarEGeEomMaGa"';
const TEACHER_COMMENT_FONT_STACK = `${TEACHER_COMMENT_FONT_FAMILY}, ${SYSTEM_FONT_STACK}`;

// 미리보기의 12/14/10px 등을 1058px 템플릿 원본 비율로 환산한 값입니다.
const HEADER_FONT_SIZE = 54;
const TITLE_FONT_SIZE = 58;
const HEADER_FONT = `400 ${HEADER_FONT_SIZE}px ${DIARY_FONT_STACK}`;
const TITLE_FONT = `400 ${TITLE_FONT_SIZE}px ${DIARY_FONT_STACK}`;
const CONTENT_FONT_SIZE = 54;
const CONTENT_FONT = `400 ${CONTENT_FONT_SIZE}px ${DIARY_FONT_STACK}`;
const COMMENT_LABEL_FONT = `700 22px ${SYSTEM_FONT_STACK}`;
const COMMENT_FONT = `700 34px ${TEACHER_COMMENT_FONT_STACK}`;
const TAG_FONT = `400 22px ${SYSTEM_FONT_STACK}`;
const AI_WATERMARK_FONT = `700 22px ${SYSTEM_FONT_STACK}`;

const TEXT_COLOR = "#333333";
const COMMENT_COLOR = "#6b5e3f";
const LABEL_COLOR = "#806d3d";
const TAG_BACKGROUND = "#f3ecd2";
const AI_WATERMARK_COLOR = "#8B6A3E";

interface DiaryCell {
  text: string;
  mark: "circle" | "underline" | null;
}

interface CorrectionRun {
  mark: "circle" | "underline";
  row: number;
  startColumn: number;
  length: number;
}

function pxX(value: number): number {
  return value * WIDTH;
}

function pxY(value: number): number {
  return value * BASE_HEIGHT;
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
    context.scale(variation.scale, variation.scale);
    context.fillText(character, -width / 2, 0);
    context.restore();

    cursorX += width;
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

  for (const segment of segments) {
    for (const character of Array.from(segment.text)) {
      if (character === "\n") {
        while (cells.length % COLUMN_COUNT !== 0) {
          cells.push({ text: "", mark: null });
        }
      } else {
        cells.push({ text: character, mark: segment.mark });
      }
    }
  }

  return cells.slice(0, COLUMN_COUNT * rowCount);
}

function buildCorrectionRuns(cells: DiaryCell[]): CorrectionRun[] {
  const runs: CorrectionRun[] = [];
  cells.forEach((cell, index) => {
    if (cell.mark === null) return;
    const row = Math.floor(index / COLUMN_COUNT);
    const column = index % COLUMN_COUNT;
    const previous = runs[runs.length - 1];
    if (
      previous !== undefined &&
      previous.mark === cell.mark &&
      previous.row === row &&
      previous.startColumn + previous.length === column
    ) {
      previous.length += 1;
    } else {
      runs.push({ mark: cell.mark, row, startColumn: column, length: 1 });
    }
  });
  return runs;
}

function drawContent(
  context: CanvasRenderingContext2D,
  content: string,
  analysis: DiaryAnalysis | null,
  markImages: Map<string, HTMLImageElement>,
) {
  const layout = getDiaryFrameLayout(content);
  const { x, y, width, height } = layout.content;
  const cellWidth = width / COLUMN_COUNT;
  const cellHeight = height / layout.contentRows;
  const cells = buildDiaryCells(content, analysis, layout.contentRows);

  context.font = CONTENT_FONT;
  context.fillStyle = TEXT_COLOR;
  context.textAlign = "center";
  cells.forEach((cell, index) => {
    if (cell.text === "") return;
    const row = Math.floor(index / COLUMN_COUNT);
    const column = index % COLUMN_COUNT;
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

  const x = WIDTH - pxX(0.047) - width;
  const y = pxY(0.1);

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

/** 감정 → 사진 키워드 → 일기 키워드 순서로 중복 없이 최대 6개. */
export function buildDiaryTags(analysis: DiaryAnalysis): string[] {
  return [
    ...new Set([
      ...analysis.emotions,
      ...analysis.photoKeywords,
      ...analysis.diaryKeywords,
    ]),
  ].slice(0, 6);
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
  context.fillText("선생님 한줄평", x + paddingX, y + 27);

  // 미리보기의 12px 한 줄 문장을 원본 템플릿 비율로 환산한 30px입니다.
  context.font = COMMENT_FONT;
  context.fillStyle = COMMENT_COLOR;

  const commentLineHeight = DIARY_COMMENT.lineHeight;
  commentLines.forEach((line, index) => {
    context.fillText(line, x + paddingX, y + 62 + index * commentLineHeight);
  });

  const tags = buildDiaryTags(analysis);
  context.font = TAG_FONT;
  let tagX = x + paddingX;
  // 짧은 한줄평에서도 태그를 박스 맨 아래에 고정하지 않습니다.
  // 미리보기와 동일하게 실제 댓글 줄 수 바로 다음 행에 배치합니다.
  const tagY = y + 50 + commentLines.length * commentLineHeight;
  for (const tag of tags) {
    const text = `#${tag}`;
    const tagWidth = context.measureText(text).width + 24;
    if (tagX + tagWidth > x + width - paddingX) break;
    context.fillStyle = TAG_BACKGROUND;
    roundRectPath(context, tagX, tagY, tagWidth, 34, 17);
    context.fill();
    context.fillStyle = COMMENT_COLOR;
    context.fillText(text, tagX + 12, tagY + 24);
    tagX += tagWidth + 8;
  }
  context.restore();
}

function wrapCommentToFrame(
  context: CanvasRenderingContext2D,
  comment: string,
): string[] {
  const maxWidth =
    DIARY_FRAME.comment.width - DIARY_COMMENT.paddingX * 2;
  const lines: string[] = [];
  let currentLine = "";

  for (const character of Array.from(`“${comment.trim()}”`)) {
    const candidate = currentLine + character;
    if (
      currentLine !== "" &&
      context.measureText(candidate).width > maxWidth
    ) {
      lines.push(currentLine);
      currentLine = character;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine !== "") lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
}

function drawFrameTemplate(
  context: CanvasRenderingContext2D,
  template: HTMLImageElement,
  layout: DiaryFrameLayout,
) {
  context.drawImage(
    template,
    0,
    0,
    WIDTH,
    DIARY_FRAME.topHeight,
    0,
    0,
    WIDTH,
    DIARY_FRAME.topHeight,
  );

  for (let row = 0; row < layout.contentRows; row += 1) {
    context.drawImage(
      template,
      0,
      DIARY_FRAME.topHeight,
      WIDTH,
      DIARY_FRAME.rowHeight,
      0,
      DIARY_FRAME.topHeight + row * DIARY_FRAME.rowHeight,
      WIDTH,
      DIARY_FRAME.rowHeight,
    );
  }

  const bottomTopHeight =
    DIARY_COMMENT.bottomSplitSourceY - DIARY_FRAME.bottomSourceY;
  context.drawImage(
    template,
    0,
    DIARY_FRAME.bottomSourceY,
    WIDTH,
    bottomTopHeight,
    0,
    layout.bottomTop,
    WIDTH,
    bottomTopHeight,
  );

  let extensionY = layout.bottomTop + bottomTopHeight;
  let remainingExtension = layout.commentExtraHeight;
  while (remainingExtension > 0) {
    const sliceHeight = Math.min(
      DIARY_COMMENT.extensionSliceHeight,
      remainingExtension,
    );
    context.drawImage(
      template,
      0,
      DIARY_COMMENT.extensionSourceY,
      WIDTH,
      sliceHeight,
      0,
      extensionY,
      WIDTH,
      sliceHeight,
    );
    extensionY += sliceHeight;
    remainingExtension -= sliceHeight;
  }

  const bottomTailHeight =
    DIARY_FRAME.baseHeight - DIARY_COMMENT.bottomSplitSourceY;
  context.drawImage(
    template,
    0,
    DIARY_COMMENT.bottomSplitSourceY,
    WIDTH,
    bottomTailHeight,
    0,
    extensionY,
    WIDTH,
    bottomTailHeight,
  );
}

export async function composeDiaryImage(
  input: DiaryImageInput,
): Promise<ComposedDiaryImage> {
  const [image, template, weatherIcon] = await Promise.all([
    loadImageFromDataUrl(input.imageDataUrl),
    loadImageFromDataUrl(TEMPLATE_URL),
    loadImageFromDataUrl(weatherIconUrl(input.weather)),
  ]);

  // 손그림 첨삭 에셋은 분석 결과가 있을 때만 필요합니다. 8장 전부를
  // 미리 받아두는 이유: drawContent는 동기 함수라 그리는 도중에는
  // 로드를 기다릴 수 없기 때문입니다 (번들 내 로컬 파일이라 비용은 미미).
  const markImages = new Map<string, HTMLImageElement>();
  if (input.analysis !== null) {
    await Promise.all(
      CORRECTION_MARK_URLS.map(async (url) => {
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

  const tags =
    input.analysis === null ? [] : buildDiaryTags(input.analysis);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageProcessError("load-failed");

  // 배경 프레임의 실제 한줄평 칸(좌우 25px 안쪽)과 로드된 글꼴의
  // 측정 폭으로 줄을 나눕니다. 글자 수 추정은 여백이 남아도 조기
  // 줄바꿈될 수 있어 저장 이미지와 프레임 칸이 어긋납니다.
  context.font = COMMENT_FONT;
  const commentLines =
    input.analysis === null
      ? [""]
      : wrapCommentToFrame(context, input.analysis.comment);
  const frameLayout = getDiaryFrameLayout(
    input.content,
    commentLines.length,
    tags.length > 0,
  );

  canvas.height = frameLayout.height;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.textBaseline = "alphabetic";

  // DOM 미리보기와 같은 순서: 템플릿 → 사진 → 글자/첨삭 → 한줄평/태그.
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
    { text: year, left: 0.045, maxWidth: 70, seed: 0 },
    { text: String(Number(month)), left: 0.167, maxWidth: 70, seed: 10 },
    { text: String(Number(day)), left: 0.271, maxWidth: 70, seed: 20 },
    { text: weekday, left: 0.42, maxWidth: 78, seed: 30 },
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
  drawHandwrittenText(
    context,
    input.title || "제목 없는 일기",
    titleX,
    titleY + titleHeight / 2 + 20,
    50,
    TITLE_HANDWRITING_STRENGTH,
  );
  context.restore();

  drawContent(context, input.content, input.analysis, markImages);
  drawComment(context, input.analysis, frameLayout, commentLines);
  if (input.includesAiGeneratedContent) {
    drawAiContentWatermark(context);
  }

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    frameLayout,
  };
}
