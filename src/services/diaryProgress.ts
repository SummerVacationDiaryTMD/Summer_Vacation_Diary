import {
  invokeDiaryAi,
  isSupabaseConfigured,
} from "./supabaseEdge";

export type DiaryMilestoneMetric = "streak" | "total-days";
export type DiaryMilestoneTier = "small" | "special";

export interface DiaryMilestone {
  metric: DiaryMilestoneMetric;
  threshold: number;
  tier: DiaryMilestoneTier;
  title: string;
  message: string;
}

export interface DiaryProgressSnapshot {
  activityDate: string;
  daysAway: number | null;
  visitDays: number;
  currentStreak: number;
  totalActivityDays: number;
  completedToday: boolean;
  newlyCompleted: boolean;
  milestones: DiaryMilestone[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PROGRESS_TIMEOUT_MS = 8_000;
const PROGRESS_CACHE_KEY = "summer-vacation-diary:progress-cache:v1";
const LOCAL_PROGRESS_KEY = "summer-vacation-diary:progress-local:v1";
const PENDING_COMPLETION_KEY =
  "summer-vacation-diary:progress-pending-completion:v1";

interface LocalProgressRecord {
  activityDays: string[];
  lastSeenOn: string | null;
  visitDays: number;
}

const LOCAL_MILESTONES: DiaryMilestone[] = [
  {
    metric: "streak",
    threshold: 1,
    tier: "small",
    title: "첫 일기 도장을 찍었어요",
    message: "오늘의 여름을 멋지게 남겼어요.",
  },
  {
    metric: "streak",
    threshold: 2,
    tier: "small",
    title: "이틀 연속 기록했어요",
    message: "어제의 이야기에 오늘의 이야기가 이어졌어요.",
  },
  {
    metric: "streak",
    threshold: 3,
    tier: "small",
    title: "벌써 사흘째예요",
    message: "작은 기록이 즐거운 습관이 되고 있어요.",
  },
  {
    metric: "streak",
    threshold: 5,
    tier: "special",
    title: "다섯 번째 도장 완성",
    message: "손가락을 모두 펼 만큼 도장을 모았어요.",
  },
  {
    metric: "streak",
    threshold: 7,
    tier: "special",
    title: "일주일 연속 일기 달성",
    message: "한 주의 여름이 일기장에 담겼어요.",
  },
  {
    metric: "streak",
    threshold: 10,
    tier: "small",
    title: "열흘 연속 기록했어요",
    message: "열 번의 하루가 한 줄로 이어졌어요.",
  },
  {
    metric: "streak",
    threshold: 14,
    tier: "special",
    title: "2주 동안 이어왔어요",
    message: "하루하루가 멋진 이야기가 됐어요.",
  },
  {
    metric: "streak",
    threshold: 21,
    tier: "small",
    title: "3주 연속 기록했어요",
    message: "도장 친구가 오늘도 기다리고 있었어요.",
  },
  {
    metric: "streak",
    threshold: 28,
    tier: "small",
    title: "4주 연속 기록했어요",
    message: "네 주의 장면이 차곡차곡 모였어요.",
  },
  {
    metric: "streak",
    threshold: 30,
    tier: "special",
    title: "한 달의 기록 완성",
    message: "한 달 동안 매일의 장면을 남겼어요.",
  },
  {
    metric: "streak",
    threshold: 35,
    tier: "small",
    title: "5주 연속 기록했어요",
    message: "꾸준한 기록이 일기장을 채우고 있어요.",
  },
  {
    metric: "streak",
    threshold: 42,
    tier: "small",
    title: "6주 연속 기록했어요",
    message: "여섯 주의 이야기가 길게 이어졌어요.",
  },
  {
    metric: "streak",
    threshold: 50,
    tier: "special",
    title: "50개의 하루를 이었어요",
    message: "정말 단단한 기록 습관이 생겼어요.",
  },
  {
    metric: "streak",
    threshold: 60,
    tier: "small",
    title: "두 달 연속 기록했어요",
    message: "두 달의 하루가 모두 일기가 됐어요.",
  },
  {
    metric: "streak",
    threshold: 75,
    tier: "small",
    title: "75일 연속 기록했어요",
    message: "도장 친구와 오래 멋진 길을 걸었어요.",
  },
  {
    metric: "streak",
    threshold: 90,
    tier: "small",
    title: "90일 연속 기록했어요",
    message: "한 계절만큼의 이야기가 모였어요.",
  },
  {
    metric: "streak",
    threshold: 100,
    tier: "special",
    title: "100일 연속 일기 달성",
    message: "백 번의 하루가 한 권의 이야기가 됐어요.",
  },
  {
    metric: "streak",
    threshold: 150,
    tier: "small",
    title: "150일 연속 기록했어요",
    message: "매일 남긴 마음이 큰 이야기가 됐어요.",
  },
  {
    metric: "streak",
    threshold: 180,
    tier: "special",
    title: "반년을 기록했어요",
    message: "여섯 달의 시간이 일기장에 담겼어요.",
  },
  {
    metric: "streak",
    threshold: 200,
    tier: "small",
    title: "200일 연속 기록했어요",
    message: "이백 개의 하루를 빠짐없이 남겼어요.",
  },
  {
    metric: "streak",
    threshold: 300,
    tier: "small",
    title: "300일 연속 기록했어요",
    message: "삼백 번의 도장이 멋진 길이 됐어요.",
  },
  {
    metric: "streak",
    threshold: 365,
    tier: "special",
    title: "한 해를 기록했어요",
    message: "사계절의 이야기를 모두 담았어요.",
  },
  {
    metric: "total-days",
    threshold: 10,
    tier: "small",
    title: "지금까지 10일을 기록했어요",
    message: "연속 기록과 상관없이 열 개의 하루가 남았어요.",
  },
  {
    metric: "total-days",
    threshold: 30,
    tier: "special",
    title: "30일의 이야기를 모았어요",
    message: "다시 시작한 날까지 모두 소중한 기록이에요.",
  },
  {
    metric: "total-days",
    threshold: 50,
    tier: "special",
    title: "50일을 기록했어요",
    message: "일기장에 쉰 개의 하루가 차곡차곡 쌓였어요.",
  },
  {
    metric: "total-days",
    threshold: 100,
    tier: "special",
    title: "100일을 기록했어요",
    message: "이어진 날과 다시 시작한 날이 모두 모였어요.",
  },
  {
    metric: "total-days",
    threshold: 200,
    tier: "small",
    title: "200일을 기록했어요",
    message: "오랫동안 남긴 하루가 큰 이야기가 됐어요.",
  },
  {
    metric: "total-days",
    threshold: 365,
    tier: "special",
    title: "365일을 기록했어요",
    message: "기록한 날들이 한 해만큼 모였어요.",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function parseMilestone(value: unknown): DiaryMilestone | null {
  if (!isRecord(value)) {
    return null;
  }
  const threshold = nonNegativeInteger(value.threshold);
  if (
    (value.metric !== "streak" && value.metric !== "total-days") ||
    (value.tier !== "small" && value.tier !== "special") ||
    threshold === null ||
    threshold < 1 ||
    typeof value.title !== "string" ||
    typeof value.message !== "string"
  ) {
    return null;
  }
  return {
    metric: value.metric,
    threshold,
    tier: value.tier,
    title: value.title,
    message: value.message,
  };
}

function parseProgressResponse(value: unknown): DiaryProgressSnapshot {
  if (!isRecord(value) || !isRecord(value.progress)) {
    throw new Error("invalid-progress-response");
  }
  const progress = value.progress;
  const currentStreak = nonNegativeInteger(progress.currentStreak);
  const totalActivityDays = nonNegativeInteger(progress.totalActivityDays);
  const visitDays = nonNegativeInteger(progress.visitDays);
  const milestones = Array.isArray(progress.milestones)
    ? progress.milestones
        .map(parseMilestone)
        .filter((item): item is DiaryMilestone => item !== null)
    : [];
  const daysAway = progress.daysAway;

  if (
    typeof progress.activityDate !== "string" ||
    !DATE_PATTERN.test(progress.activityDate) ||
    currentStreak === null ||
    totalActivityDays === null ||
    visitDays === null ||
    typeof progress.completedToday !== "boolean" ||
    !(
      daysAway === undefined ||
      daysAway === null ||
      nonNegativeInteger(daysAway) !== null
    )
  ) {
    throw new Error("invalid-progress-response");
  }

  return {
    activityDate: progress.activityDate,
    daysAway:
      daysAway === undefined || daysAway === null ? null : Number(daysAway),
    visitDays,
    currentStreak,
    totalActivityDays,
    completedToday: progress.completedToday,
    newlyCompleted: progress.newlyCompleted === true,
    milestones,
  };
}

function kstTodayString(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addUtcDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dateDistance(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.max(
    Math.round(
      (Date.UTC(toYear, toMonth - 1, toDay) -
        Date.UTC(fromYear, fromMonth - 1, fromDay)) /
        86_400_000,
    ),
    0,
  );
}

function currentStreak(activityDays: string[], today: string): number {
  const days = new Set(activityDays);
  let cursor = days.has(today)
    ? today
    : days.has(addUtcDays(today, -1))
      ? addUtcDays(today, -1)
      : null;
  let count = 0;
  while (cursor !== null && days.has(cursor)) {
    count += 1;
    cursor = addUtcDays(cursor, -1);
  }
  return count;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Progress is motivational metadata; storage failure must not block a diary.
  }
}

function pendingCompletionDay(): string | null {
  const value = readJson(PENDING_COMPLETION_KEY);
  return typeof value === "string" && DATE_PATTERN.test(value) ? value : null;
}

function setPendingCompletionDay(date: string | null): void {
  try {
    if (date === null) {
      localStorage.removeItem(PENDING_COMPLETION_KEY);
    } else {
      localStorage.setItem(PENDING_COMPLETION_KEY, JSON.stringify(date));
    }
  } catch {
    // A retry hint is best effort and never affects the archived diary.
  }
}

function readLocalProgress(): LocalProgressRecord {
  const value = readJson(LOCAL_PROGRESS_KEY);
  if (!isRecord(value)) {
    return { activityDays: [], lastSeenOn: null, visitDays: 0 };
  }
  const activityDays = Array.isArray(value.activityDays)
    ? value.activityDays.filter(
        (date): date is string =>
          typeof date === "string" && DATE_PATTERN.test(date),
      )
    : [];
  return {
    activityDays: Array.from(new Set(activityDays)).sort(),
    lastSeenOn:
      typeof value.lastSeenOn === "string" &&
      DATE_PATTERN.test(value.lastSeenOn)
        ? value.lastSeenOn
        : null,
    visitDays: nonNegativeInteger(value.visitDays) ?? 0,
  };
}

function snapshotFromLocal(
  record: LocalProgressRecord,
  today: string,
  daysAway: number | null,
  newlyCompleted = false,
): DiaryProgressSnapshot {
  const streak = currentStreak(record.activityDays, today);
  const total = record.activityDays.length;
  return {
    activityDate: today,
    daysAway,
    visitDays: record.visitDays,
    currentStreak: streak,
    totalActivityDays: total,
    completedToday: record.activityDays.includes(today),
    newlyCompleted,
    milestones: newlyCompleted
      ? LOCAL_MILESTONES.filter(
          (item) =>
            (item.metric === "streak" && item.threshold === streak) ||
            (item.metric === "total-days" && item.threshold === total),
        )
      : [],
  };
}

function recordLocalVisit(): DiaryProgressSnapshot {
  const today = kstTodayString();
  const current = readLocalProgress();
  const daysAway =
    current.lastSeenOn === null
      ? null
      : dateDistance(current.lastSeenOn, today);
  const next = {
    ...current,
    lastSeenOn: today,
    visitDays:
      current.lastSeenOn === today
        ? current.visitDays
        : current.visitDays + 1,
  };
  writeJson(LOCAL_PROGRESS_KEY, next);
  return snapshotFromLocal(next, today, daysAway);
}

function recordLocalCompletion(): DiaryProgressSnapshot {
  const today = kstTodayString();
  const current = readLocalProgress();
  const newlyCompleted = !current.activityDays.includes(today);
  const next: LocalProgressRecord = {
    activityDays: newlyCompleted
      ? [...current.activityDays, today].sort()
      : current.activityDays,
    lastSeenOn: today,
    visitDays:
      current.lastSeenOn === today
        ? current.visitDays
        : current.visitDays + 1,
  };
  writeJson(LOCAL_PROGRESS_KEY, next);
  return snapshotFromLocal(next, today, 0, newlyCompleted);
}

function cacheSnapshot(snapshot: DiaryProgressSnapshot): void {
  writeJson(PROGRESS_CACHE_KEY, snapshot);
}

export function readCachedDiaryProgress(): DiaryProgressSnapshot | null {
  const value = readJson(PROGRESS_CACHE_KEY);
  if (!isRecord(value)) {
    return null;
  }
  try {
    return parseProgressResponse({ progress: value });
  } catch {
    return null;
  }
}

let visitInFlight: Promise<DiaryProgressSnapshot> | null = null;
let visitedSessionDay: string | null = null;

export function recordDiaryVisit(): Promise<DiaryProgressSnapshot> {
  const today = kstTodayString();
  if (visitedSessionDay === today) {
    const cached = readCachedDiaryProgress();
    if (cached !== null) {
      return Promise.resolve(cached);
    }
  }
  if (visitInFlight !== null) {
    return visitInFlight;
  }

  visitInFlight = (async () => {
    let snapshot: DiaryProgressSnapshot;
    if (isSupabaseConfigured) {
      snapshot = parseProgressResponse(
        await invokeDiaryAi(
          { action: "progress-visit" },
          PROGRESS_TIMEOUT_MS,
        ),
      );
      const pending = pendingCompletionDay();
      if (pending === today) {
        try {
          snapshot = parseProgressResponse(
            await invokeDiaryAi(
              { action: "progress-complete" },
              PROGRESS_TIMEOUT_MS,
            ),
          );
          setPendingCompletionDay(null);
        } catch {
          // Keep the hint for another same-day foreground visit.
        }
      } else if (pending !== null) {
        setPendingCompletionDay(null);
      }
    } else {
      snapshot = recordLocalVisit();
    }
    visitedSessionDay = today;
    cacheSnapshot(snapshot);
    return snapshot;
  })().finally(() => {
    visitInFlight = null;
  });

  return visitInFlight;
}

export async function recordDiaryCompletion(): Promise<DiaryProgressSnapshot> {
  let snapshot: DiaryProgressSnapshot;
  if (isSupabaseConfigured) {
    try {
      snapshot = parseProgressResponse(
        await invokeDiaryAi(
          { action: "progress-complete" },
          PROGRESS_TIMEOUT_MS,
        ),
      );
      setPendingCompletionDay(null);
    } catch (error) {
      setPendingCompletionDay(kstTodayString());
      throw error;
    }
  } else {
    snapshot = recordLocalCompletion();
  }
  visitedSessionDay = kstTodayString();
  cacheSnapshot(snapshot);
  return snapshot;
}
