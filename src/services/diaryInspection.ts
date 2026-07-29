import { invokeDiaryAi } from "./supabaseEdge";

export interface DiaryInspectionContext {
  id: string;
  runSketch: boolean;
  runAnalyze: boolean;
}

interface InspectionBatch {
  context: DiaryInspectionContext;
  photoDataUrl?: string;
  analysisInput?: {
    photoDataUrl: string | null;
    content: string;
  };
  sketch?: Deferred<string>;
  analysis?: Deferred<unknown>;
  timer: ReturnType<typeof setTimeout>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const INSPECTION_TIMEOUT_MS = 150_000;
const REGISTRATION_TIMEOUT_MS = 500;
const batches = new Map<string, InspectionBatch>();
const closedIds = new Set<string>();

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function createDiaryInspectionContext(
  runSketch: boolean,
  runAnalyze: boolean,
): DiaryInspectionContext {
  return {
    id:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    runSketch,
    runAnalyze,
  };
}

function getBatch(context: DiaryInspectionContext): InspectionBatch {
  const existing = batches.get(context.id);
  if (existing !== undefined) {
    return existing;
  }

  const batch: InspectionBatch = {
    context,
    timer: setTimeout(() => dispatch(context.id), REGISTRATION_TIMEOUT_MS),
  };
  batches.set(context.id, batch);
  return batch;
}

function isReady(batch: InspectionBatch): boolean {
  return (
    (!batch.context.runSketch || batch.sketch !== undefined) &&
    (!batch.context.runAnalyze || batch.analysis !== undefined)
  );
}

function dispatchIfReady(batch: InspectionBatch): void {
  if (isReady(batch)) {
    clearTimeout(batch.timer);
    void dispatch(batch.context.id);
  }
}

async function dispatch(id: string): Promise<void> {
  const batch = batches.get(id);
  if (batch === undefined) {
    return;
  }
  batches.delete(id);
  closedIds.add(id);
  if (closedIds.size > 20) {
    const oldest = closedIds.values().next().value;
    if (oldest !== undefined) {
      closedIds.delete(oldest);
    }
  }
  clearTimeout(batch.timer);

  const runSketch =
    batch.context.runSketch &&
    batch.sketch !== undefined &&
    batch.photoDataUrl !== undefined;
  const runAnalyze =
    batch.context.runAnalyze &&
    batch.analysis !== undefined &&
    batch.analysisInput !== undefined;

  if (!runSketch && !runAnalyze) {
    const error = new Error("inspection-input-missing");
    batch.sketch?.reject(error);
    batch.analysis?.reject(error);
    return;
  }

  try {
    const body = await invokeDiaryAi(
      {
        action: "inspect",
        runSketch,
        runAnalyze,
        ...(runSketch ? { photoDataUrl: batch.photoDataUrl } : {}),
        ...(runAnalyze ? { input: batch.analysisInput } : {}),
      },
      INSPECTION_TIMEOUT_MS,
    );
    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    if (runSketch) {
      const imageBase64 = record.imageBase64;
      if (typeof imageBase64 !== "string" || imageBase64 === "") {
        batch.sketch?.reject(new Error("invalid-sketch-response"));
      } else {
        batch.sketch?.resolve(imageBase64);
      }
    }
    if (runAnalyze) {
      if (!("analysis" in record)) {
        batch.analysis?.reject(new Error("invalid-analysis-response"));
      } else {
        batch.analysis?.resolve(record.analysis);
      }
    }
  } catch (error) {
    batch.sketch?.reject(error);
    batch.analysis?.reject(error);
  }
}

export function requestInspectionSketch(
  context: DiaryInspectionContext,
  photoDataUrl: string,
): Promise<string> {
  if (closedIds.has(context.id)) {
    return Promise.reject(new Error("inspection-already-dispatched"));
  }
  const batch = getBatch(context);
  batch.photoDataUrl = photoDataUrl;
  batch.sketch ??= deferred<string>();
  dispatchIfReady(batch);
  return batch.sketch.promise;
}

export function requestInspectionAnalysis(
  context: DiaryInspectionContext,
  input: { photoDataUrl: string | null; content: string },
): Promise<unknown> {
  if (closedIds.has(context.id)) {
    return Promise.reject(new Error("inspection-already-dispatched"));
  }
  const batch = getBatch(context);
  batch.analysisInput = input;
  batch.analysis ??= deferred<unknown>();
  dispatchIfReady(batch);
  return batch.analysis.promise;
}
