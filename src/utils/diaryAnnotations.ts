import type { DiaryAnalysis } from "../services/diaryAnalysis";
import { buildHighlightSegments } from "./highlight";
import {
  DIARY_FRAME,
  type DiaryFrameLayout,
  type DiaryFrameRegion,
} from "./diaryFrameLayout";
import {
  buildProfanityCheckRuns,
  type ProfanityCheckRun,
} from "./profanityCheck";
import { buildStarPlacements, type StarPlacement } from "./starMarks";

export interface DiaryCell {
  text: string;
  mark: "circle" | "underline" | "both" | null;
}

export interface CorrectionRun {
  mark: "circle" | "underline";
  row: number;
  startColumn: number;
  length: number;
}

interface TimedAnnotation {
  delayMs: number;
  durationMs: number;
}

export type AnnotationTimelineEvent =
  | (TimedAnnotation & {
      kind: "underline";
      run: CorrectionRun;
      originalRun: CorrectionRun;
    })
  | (TimedAnnotation & {
      kind: "circle";
      run: CorrectionRun;
    })
  | (TimedAnnotation & {
      kind: "star";
      placement: StarPlacement;
    })
  | (TimedAnnotation & {
      kind: "profanity";
      run: ProfanityCheckRun;
    });

export interface AnnotationTimeline {
  events: AnnotationTimelineEvent[];
  totalDurationMs: number;
}

interface UntimedAnnotation {
  kind: AnnotationTimelineEvent["kind"];
  row: number;
  orderColumn: number;
  priority: number;
  durationMs: number;
  run?: CorrectionRun | ProfanityCheckRun;
  originalRun?: CorrectionRun;
  placement?: StarPlacement;
}

const FIRST_MARK_DELAY_MS = 300;
const MARK_GAP_MS = 100;
const UNDERLINE_MS_PER_CELL = 180;
const UNDERLINE_MIN_DURATION_MS = 320;
const CIRCLE_DURATION_MS = 1_350;
const STAR_DURATION_MS = 1_500;
const PROFANITY_DURATION_MS = 850;

export const ANNOTATION_GEOMETRY = {
  circleInsetY: 0.06,
  circleHeight: 0.88,
  underlineHeight: 0.16,
  underlineBottomInset: 0.05,
  starSize: 0.84,
  starOffsetX: 0.28,
  starOffsetY: 0.22,
} as const;

export function buildDiaryCells(
  content: string,
  analysis: DiaryAnalysis | null,
  columnCount: number,
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
        while (cells.length % columnCount !== 0) {
          cells.push({ text: "", mark: null });
        }
      } else {
        cells.push({ text: character, mark: segment.mark });
      }
    }
  }

  const visibleCellCount = columnCount * rowCount;
  while (cells.length < visibleCellCount) {
    cells.push({ text: "", mark: null });
  }

  return cells.slice(0, visibleCellCount);
}

export function buildCorrectionRuns(
  cells: DiaryCell[],
  columnCount: number,
): CorrectionRun[] {
  const runs: CorrectionRun[] = [];

  (["circle", "underline"] as const).forEach((mark) => {
    cells.forEach((cell, index) => {
      if (cell.mark !== mark && cell.mark !== "both") {
        return;
      }

      const row = Math.floor(index / columnCount);
      const column = index % columnCount;
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

function underlineDuration(length: number): number {
  return Math.max(UNDERLINE_MIN_DURATION_MS, length * UNDERLINE_MS_PER_CELL);
}

const SENTENCE_END_PATTERN = /[.!?。！？]/u;

function buildCellSentenceIndexes(
  content: string,
  columnCount: number,
  visibleCellCount: number,
): number[] {
  const sentenceIndexes = Array<number>(visibleCellCount).fill(0);
  let cellIndex = 0;
  let sentenceIndex = 0;

  for (const character of Array.from(content)) {
    if (character === "\n") {
      const remainder = cellIndex % columnCount;
      if (remainder !== 0) {
        cellIndex += columnCount - remainder;
      }
      sentenceIndex += 1;
      continue;
    }

    if (cellIndex >= visibleCellCount) {
      break;
    }

    sentenceIndexes[cellIndex] = sentenceIndex;
    cellIndex += 1;

    if (SENTENCE_END_PATTERN.test(character)) {
      sentenceIndex += 1;
    }
  }

  return sentenceIndexes;
}

function annotationStartColumn(annotation: UntimedAnnotation): number {
  if (annotation.placement !== undefined) {
    return annotation.placement.column;
  }
  if (annotation.run !== undefined) {
    return annotation.run.startColumn;
  }
  return annotation.orderColumn;
}

/**
 * Builds one teacher-like pass over the manuscript, grouped by sentence.
 * Sentences keep their reading order; inside each sentence the teacher
 * finishes every underline before drawing circles, stars and profanity marks.
 */
export function buildAnnotationTimeline(
  content: string,
  analysis: DiaryAnalysis | null,
  columnCount: number,
  rowCount: number,
): AnnotationTimeline {
  if (analysis === null) {
    return { events: [], totalDurationMs: 0 };
  }

  const cells = buildDiaryCells(content, analysis, columnCount, rowCount);
  const correctionRuns = buildCorrectionRuns(cells, columnCount);
  const circles = correctionRuns.filter((run) => run.mark === "circle");
  const underlines = correctionRuns.filter((run) => run.mark === "underline");
  const stars = buildStarPlacements(
    content,
    analysis.starWords,
    columnCount,
    columnCount * rowCount,
  );
  const profanityRuns = buildProfanityCheckRuns(
    content,
    columnCount,
    columnCount * rowCount,
  );

  const untimedEvents: UntimedAnnotation[] = [
    ...underlines.map((run) => ({
      kind: "underline" as const,
      row: run.row,
      orderColumn: run.startColumn,
      priority: 0,
      durationMs: underlineDuration(run.length),
      run,
      originalRun: run,
    })),
    ...circles.map((run) => ({
      kind: "circle" as const,
      row: run.row,
      orderColumn: run.startColumn,
      priority: 1,
      durationMs: CIRCLE_DURATION_MS,
      run,
    })),
    ...stars.map((placement) => ({
      kind: "star" as const,
      row: placement.row,
      orderColumn: placement.column,
      priority: 2,
      durationMs: STAR_DURATION_MS,
      placement,
    })),
    ...profanityRuns.map((run) => ({
      kind: "profanity" as const,
      row: run.row,
      orderColumn: run.startColumn,
      priority: 3,
      durationMs: PROFANITY_DURATION_MS,
      run,
    })),
  ];

  const sentenceIndexes = buildCellSentenceIndexes(
    content,
    columnCount,
    columnCount * rowCount,
  );
  const sentenceOf = (annotation: UntimedAnnotation) =>
    sentenceIndexes[
      annotation.row * columnCount + annotationStartColumn(annotation)
    ] ?? Number.MAX_SAFE_INTEGER;

  untimedEvents.sort(
    (first, second) =>
      sentenceOf(first) - sentenceOf(second) ||
      first.priority - second.priority ||
      first.row - second.row ||
      first.orderColumn - second.orderColumn ||
      first.durationMs - second.durationMs,
  );

  let cursorMs = FIRST_MARK_DELAY_MS;
  const events: AnnotationTimelineEvent[] = untimedEvents.map((event) => {
    const timing = {
      delayMs: cursorMs,
      durationMs: event.durationMs,
    };
    cursorMs += event.durationMs + MARK_GAP_MS;

    if (event.kind === "star" && event.placement !== undefined) {
      return { ...timing, kind: "star", placement: event.placement };
    }
    if (event.kind === "circle" && event.run !== undefined) {
      return {
        ...timing,
        kind: "circle",
        run: event.run as CorrectionRun,
      };
    }
    if (event.kind === "profanity" && event.run !== undefined) {
      return {
        ...timing,
        kind: "profanity",
        run: event.run as ProfanityCheckRun,
      };
    }
    return {
      ...timing,
      kind: "underline",
      run: event.run as CorrectionRun,
      originalRun: event.originalRun as CorrectionRun,
    };
  });

  return {
    events,
    totalDurationMs:
      events.length === 0
        ? 0
        : Math.max(FIRST_MARK_DELAY_MS, cursorMs - MARK_GAP_MS),
  };
}

function cellMeasurements(layout: DiaryFrameLayout) {
  return {
    width: layout.content.width / DIARY_FRAME.columns,
    height: layout.content.height / layout.contentRows,
  };
}

export function correctionMarkBox(
  layout: DiaryFrameLayout,
  run: CorrectionRun,
): DiaryFrameRegion {
  const cell = cellMeasurements(layout);
  const baseX = layout.content.x + run.startColumn * cell.width;
  const baseY = layout.content.y + run.row * cell.height;
  const width = run.length * cell.width;

  if (run.mark === "circle") {
    return {
      x: baseX,
      y: baseY + cell.height * ANNOTATION_GEOMETRY.circleInsetY,
      width,
      height: cell.height * ANNOTATION_GEOMETRY.circleHeight,
    };
  }

  const height = cell.height * ANNOTATION_GEOMETRY.underlineHeight;
  return {
    x: baseX,
    y:
      baseY +
      cell.height -
      height -
      cell.height * ANNOTATION_GEOMETRY.underlineBottomInset,
    width,
    height,
  };
}

export function starMarkBox(
  layout: DiaryFrameLayout,
  placement: StarPlacement,
): DiaryFrameRegion {
  const cell = cellMeasurements(layout);
  const size = Math.min(cell.width, cell.height) * ANNOTATION_GEOMETRY.starSize;
  const cellX = layout.content.x + placement.column * cell.width;
  const cellY = layout.content.y + placement.row * cell.height;

  return {
    x: Math.min(
      Math.max(cellX - size * ANNOTATION_GEOMETRY.starOffsetX, 0),
      layout.width - size,
    ),
    y: Math.min(
      Math.max(cellY - size * ANNOTATION_GEOMETRY.starOffsetY, 0),
      layout.height - size,
    ),
    width: size,
    height: size,
  };
}

export function profanityMarkBox(
  layout: DiaryFrameLayout,
  run: ProfanityCheckRun,
): DiaryFrameRegion {
  const cell = cellMeasurements(layout);
  return {
    x: layout.content.x + run.startColumn * cell.width,
    y: layout.content.y + run.row * cell.height,
    width: run.length * cell.width,
    height: cell.height,
  };
}
