import { useCallback, useEffect, useRef, useState } from "react";

import {
  DRAFT_STORAGE_KEY,
  TITLE_MAX_LENGTH,
  WEATHER_OPTIONS,
} from "../constants/diary";
import type { WeatherValue } from "../constants/diary";
import { localTodayString } from "../utils/diaryDate";

export type TimeOfDay = "day" | "night";

export interface DiaryDraft {
  /** Stable identity for one logical diary, preserved while it is edited. */
  draftId: string;
  photoDataUrl: string | null;
  /**
   * Stage-3 colored-pencil drawing made from photoDataUrl. Lives in the draft
   * (not in the hook that produces it) so it persists across app restarts —
   * each conversion is a paid API call worth keeping. Must be cleared
   * whenever photoDataUrl changes; App.tsx does that in onPhotoChange.
   */
  sketchDataUrl: string | null;
  title: string;
  content: string;
  /**
   * Local date in YYYY-MM-DD, fixed to the day the draft was created. A diary
   * belongs to the day it is written on, so this is derived once and never
   * edited — `DiaryDraftPatch` excludes it so no screen can drift from that.
   */
  date: string;
  weather: WeatherValue;
  /** Visual-only sky theme. It is never included in an AI request. */
  timeOfDay: TimeOfDay;
}

/**
 * What a screen may change. Everything except the two fields that identify the
 * diary itself: `draftId` (its identity) and `date` (the day it is written for).
 */
export type DiaryDraftPatch = Partial<Omit<DiaryDraft, "draftId" | "date">>;

function currentTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18 ? "day" : "night";
}

function createDraftId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function emptyDraft(): DiaryDraft {
  return {
    draftId: createDraftId(),
    photoDataUrl: null,
    sketchDataUrl: null,
    title: "",
    content: "",
    date: localTodayString(),
    weather: "sunny",
    timeOfDay: currentTimeOfDay(),
  };
}

const WEATHER_VALUES = WEATHER_OPTIONS.map((option) => option.value);

// localStorage data is user-editable and may come from an older app version,
// so every field is checked instead of trusting JSON.parse's result shape.
function loadDraft(): DiaryDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw === null) {
      return emptyDraft();
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return emptyDraft();
    }
    const candidate = parsed as Partial<DiaryDraft>;
    const photoDataUrl =
      typeof candidate.photoDataUrl === "string"
        ? candidate.photoDataUrl
        : null;
    return {
      draftId:
        typeof candidate.draftId === "string" && candidate.draftId !== ""
          ? candidate.draftId
          : createDraftId(),
      photoDataUrl,
      // A sketch is only meaningful for the photo it was drawn from — if the
      // stored draft has no photo, a leftover sketch must not survive either.
      sketchDataUrl:
        photoDataUrl !== null && typeof candidate.sketchDataUrl === "string"
          ? candidate.sketchDataUrl
          : null,
      title:
        typeof candidate.title === "string"
          ? Array.from(candidate.title).slice(0, TITLE_MAX_LENGTH).join("")
          : "",
      content: typeof candidate.content === "string" ? candidate.content : "",
      // The stored date is deliberately ignored: a restored draft is still
      // being written today, so it is today's diary regardless of when the
      // text was typed.
      date: localTodayString(),
      weather: WEATHER_VALUES.includes(candidate.weather as WeatherValue)
        ? (candidate.weather as WeatherValue)
        : "sunny",
      timeOfDay:
        candidate.timeOfDay === "day" || candidate.timeOfDay === "night"
          ? candidate.timeOfDay
          : currentTimeOfDay(),
    };
  } catch {
    return emptyDraft();
  }
}

const SAVE_DEBOUNCE_MS = 400;

// Saves the draft, degrading gracefully when localStorage is full: the image
// data URLs are dropped first — they are re-creatable (photo can be re-picked,
// sketch re-converted), while typed text is not. Without this, one oversized
// photo+sketch pair would make EVERY later save throw quota errors silently,
// killing 임시저장 for the text too with zero user signal.
function persistDraft(draft: DiaryDraft) {
  const attempts: DiaryDraft[] = [
    draft,
    { ...draft, sketchDataUrl: null },
    { ...draft, photoDataUrl: null, sketchDataUrl: null },
  ];
  for (const candidate of attempts) {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(candidate));
      return;
    } catch {
      // Quota exceeded — retry with the next, smaller shape.
    }
  }
  // Even the text-only draft failed (storage disabled or full of other data);
  // nothing further to do — saving must never break the UI.
}

/**
 * Keeps the in-progress diary in state and mirrors it to localStorage,
 * which implements the spec's "임시 저장" without needing a backend.
 * Trade-off: localStorage is per-device and can be cleared by the OS,
 * but that is acceptable for a draft (not the final saved diary).
 */
export function useDiaryDraft({ restoreOnStart = true } = {}) {
  const [draft, setDraft] = useState<DiaryDraft>(() =>
    restoreOnStart ? loadDraft() : emptyDraft(),
  );

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    // The debounce below can drop the last ~400ms of typing if the WebView is
    // killed right away; flushing when the page hides closes that gap.
    const flush = () => {
      persistDraft(draftRef.current);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    // Debounced save: serializing the photo data URL on every keystroke
    // would do megabytes of JSON work per character typed.
    const timer = setTimeout(() => {
      persistDraft(draft);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const updateDraft = useCallback((patch: DiaryDraftPatch) => {
    setDraft((previous) => ({ ...previous, ...patch }));
  }, []);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Ignore: clearing state below is what the user observes.
    }
    setDraft(emptyDraft());
  }, []);

  return { draft, updateDraft, clearDraft };
}
