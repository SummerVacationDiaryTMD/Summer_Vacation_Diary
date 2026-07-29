import type { DiaryStamp } from "./diaryAnalysis";

const DATABASE_NAME = "summer-vacation-diary";
const DATABASE_VERSION = 1;
const SUMMARY_STORE_NAME = "completed-diaries";
const IMAGE_STORE_NAME = "completed-diary-images";

export const MAX_DIARIES_PER_DAY = 3;

export interface CompletedDiarySummary {
  id: string;
  date: string;
  createdAt: number;
  /**
   * A diary completed after analysis always has a stamp. `null` is kept only
   * for the existing offline/error fallback that permits completion without a
   * teacher analysis; the grape must not invent an evaluation in that case.
   */
  stamp: DiaryStamp | null;
}

export interface CompletedDiary extends CompletedDiarySummary {
  imageDataUrl: string;
}

interface CompletedDiaryImage {
  id: string;
  imageDataUrl: string;
}

interface SaveCompletedDiaryInput {
  id?: string;
  date: string;
  imageDataUrl: string;
  stamp: DiaryStamp | null;
}

export class CompletedDiaryLimitError extends Error {
  constructor() {
    super("A maximum of three completed diaries can be stored per day.");
    this.name = "CompletedDiaryLimitError";
  }
}

/**
 * Day-level stamp rule: `great` wins when at least one diary has it. `effort`
 * is shown only when every completed diary for the day has that stamp.
 */
export function aggregateCompletedDiaryStamp(
  diaries: CompletedDiarySummary[],
): DiaryStamp | null {
  if (diaries.some((diary) => diary.stamp === "great")) {
    return "great";
  }
  if (
    diaries.length > 0 &&
    diaries.every((diary) => diary.stamp === "effort")
  ) {
    return "effort";
  }
  return null;
}

function isDiaryStamp(value: unknown): value is DiaryStamp {
  return value === "great" || value === "effort";
}

function isCompletedDiarySummary(
  value: unknown,
): value is CompletedDiarySummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CompletedDiarySummary>;
  return (
    typeof candidate.id === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.date ?? "") &&
    typeof candidate.createdAt === "number" &&
    (candidate.stamp === null || isDiaryStamp(candidate.stamp))
  );
}

function isCompletedDiaryImage(value: unknown): value is CompletedDiaryImage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<CompletedDiaryImage>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.imageDataUrl === "string"
  );
}

function createId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not supported."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SUMMARY_STORE_NAME)) {
        const summaryStore = database.createObjectStore(SUMMARY_STORE_NAME, {
          keyPath: "id",
        });
        summaryStore.createIndex("date", "date", { unique: false });
        summaryStore.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        database.createObjectStore(IMAGE_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("완성 일기 저장소를 열지 못했어요."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("완성 일기를 불러오지 못했어요."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("완성 일기를 저장하지 못했어요."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("완성 일기를 저장하지 못했어요."));
  });
}

async function readSummariesByDate(
  transaction: IDBTransaction,
  date: string,
): Promise<CompletedDiarySummary[]> {
  const values = await requestResult(
    transaction
      .objectStore(SUMMARY_STORE_NAME)
      .index("date")
      .getAll(IDBKeyRange.only(date)),
  );
  return values.filter(isCompletedDiarySummary);
}

export async function listCompletedDiaries(): Promise<CompletedDiarySummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUMMARY_STORE_NAME, "readonly");
    const values = await requestResult(
      transaction.objectStore(SUMMARY_STORE_NAME).getAll(),
    );
    await transactionDone(transaction);
    return values
      .filter(isCompletedDiarySummary)
      .sort((left, right) => left.createdAt - right.createdAt);
  } finally {
    database.close();
  }
}

export async function getCompletedDiariesByDate(
  date: string,
): Promise<CompletedDiary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [SUMMARY_STORE_NAME, IMAGE_STORE_NAME],
      "readonly",
    );
    const summaries = await readSummariesByDate(transaction, date);
    const imageStore = transaction.objectStore(IMAGE_STORE_NAME);
    const images = await Promise.all(
      summaries.map((summary) => requestResult(imageStore.get(summary.id))),
    );
    await transactionDone(transaction);

    const imageById = new Map(
      images
        .filter(isCompletedDiaryImage)
        .map((image) => [image.id, image.imageDataUrl]),
    );
    return summaries
      .flatMap((summary) => {
        const imageDataUrl = imageById.get(summary.id);
        return imageDataUrl === undefined ? [] : [{ ...summary, imageDataUrl }];
      })
      .sort((left, right) => left.createdAt - right.createdAt);
  } finally {
    database.close();
  }
}

export async function canAddCompletedDiary(
  date: string,
  currentDiaryId: string | null,
): Promise<boolean> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUMMARY_STORE_NAME, "readonly");
    const diaries = await readSummariesByDate(transaction, date);
    await transactionDone(transaction);
    return (
      diaries.filter((diary) => diary.id !== currentDiaryId).length <
      MAX_DIARIES_PER_DAY
    );
  } finally {
    database.close();
  }
}

export async function saveCompletedDiary(
  input: SaveCompletedDiaryInput,
): Promise<CompletedDiary> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [SUMMARY_STORE_NAME, IMAGE_STORE_NAME],
      "readwrite",
    );
    const summaryStore = transaction.objectStore(SUMMARY_STORE_NAME);
    const id = input.id ?? createId();
    const [diariesOnDate, existingValue] = await Promise.all([
      readSummariesByDate(transaction, input.date),
      requestResult(summaryStore.get(id)),
    ]);

    if (
      diariesOnDate.filter((diary) => diary.id !== id).length >=
      MAX_DIARIES_PER_DAY
    ) {
      transaction.abort();
      throw new CompletedDiaryLimitError();
    }

    const existing = isCompletedDiarySummary(existingValue)
      ? existingValue
      : null;
    const summary: CompletedDiarySummary = {
      id,
      date: input.date,
      createdAt: existing?.createdAt ?? Date.now(),
      stamp: input.stamp,
    };

    summaryStore.put(summary);
    transaction.objectStore(IMAGE_STORE_NAME).put({
      id,
      imageDataUrl: input.imageDataUrl,
    } satisfies CompletedDiaryImage);
    await transactionDone(transaction);
    return { ...summary, imageDataUrl: input.imageDataUrl };
  } finally {
    database.close();
  }
}
