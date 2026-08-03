import { useCallback, useEffect, useState } from "react";

import {
  readCachedDiaryProgress,
  recordDiaryCompletion,
  recordDiaryVisit,
  type DiaryProgressSnapshot,
} from "../services/diaryProgress";

export type DiaryProgressView =
  | { status: "loading"; snapshot: DiaryProgressSnapshot | null }
  | { status: "ready"; snapshot: DiaryProgressSnapshot }
  | { status: "error"; snapshot: DiaryProgressSnapshot | null };

export interface DiaryProgressController {
  state: DiaryProgressView;
  completeToday: () => Promise<DiaryProgressSnapshot>;
}

export function useDiaryProgress(): DiaryProgressController {
  const [state, setState] = useState<DiaryProgressView>(() => {
    const cached = readCachedDiaryProgress();
    return { status: "loading", snapshot: cached };
  });

  const refreshVisit = useCallback(async () => {
    try {
      const snapshot = await recordDiaryVisit();
      setState({ status: "ready", snapshot });
    } catch {
      setState((current) => ({
        status: "error",
        snapshot: current.snapshot,
      }));
    }
  }, []);

  useEffect(() => {
    void refreshVisit();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshVisit();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshVisit]);

  const completeToday = useCallback(async () => {
    try {
      const snapshot = await recordDiaryCompletion();
      setState({ status: "ready", snapshot });
      return snapshot;
    } catch (error) {
      setState((current) => ({
        status: "error",
        snapshot: current.snapshot,
      }));
      throw error;
    }
  }, []);

  return { state, completeToday };
}
