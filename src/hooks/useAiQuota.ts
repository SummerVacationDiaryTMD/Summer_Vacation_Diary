import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  expireQuotaSnapshot,
  getQuotaSnapshot,
  subscribeQuota,
  type QuotaBlockedReason,
  type QuotaCounter,
} from "../services/aiQuotaStore";
import {
  invokeDiaryAi,
  isAiTestMode,
  isSupabaseConfigured,
} from "../services/supabaseEdge";

export interface QuotaCounterView extends QuotaCounter {
  available: boolean;
}

/**
 * Two independent axes collapsed into one value: whether a server-backed
 * counter exists at all (`hidden` / `unknown`), and how much of it is left
 * (`ready`).
 */
export type AiQuotaView =
  | { mode: "hidden" }
  | { mode: "unknown" }
  | {
      mode: "ready";
      sketch: QuotaCounterView;
      analyze: QuotaCounterView;
      blocked: QuotaBlockedReason | null;
      resetAt: string;
    };

const QUOTA_STATUS_TIMEOUT_MS = 10_000;

const TEST_MODE_SKETCH: QuotaCounterView = {
  used: 0,
  limit: 0,
  remaining: 0,
  available: false,
};

function toView(counter: QuotaCounter): QuotaCounterView {
  return { ...counter, available: counter.remaining > 0 };
}

/**
 * Fetches the current usage snapshot. `invokeDiaryAi` records it into the store
 * on the way through, so there is nothing to return. Failures are swallowed on
 * purpose: a missing counter must never block the diary flow, and the server
 * remains the authority either way.
 */
export async function refreshAiQuota(): Promise<void> {
  if (!isSupabaseConfigured) {
    return;
  }
  try {
    await invokeDiaryAi({ action: "quota-status" }, QUOTA_STATUS_TIMEOUT_MS);
  } catch {
    // Leaves the view as "unknown"; counters stay hidden until a call succeeds.
  }
}

export function useAiQuota(): AiQuotaView {
  const snapshot = useSyncExternalStore(subscribeQuota, getQuotaSnapshot);

  // A session left open across the 09:00 KST reset would otherwise keep showing
  // yesterday's exhausted counters. The delay is at most 24h, comfortably under
  // setTimeout's ~24.8 day ceiling.
  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    const msUntilReset = Date.parse(snapshot.resetAt) - Date.now();
    if (msUntilReset <= 0) {
      expireQuotaSnapshot(Date.now());
      return;
    }
    const timer = setTimeout(
      () => expireQuotaSnapshot(Date.now()),
      msUntilReset,
    );
    return () => clearTimeout(timer);
  }, [snapshot]);

  return useMemo<AiQuotaView>(() => {
    if (!isSupabaseConfigured) {
      // Mock mode runs both operations locally and for free, so a counter would
      // be meaningless — and showing "0 left" would gate a flow that has no
      // limit at all.
      return { mode: "hidden" };
    }
    if (snapshot === null) {
      return { mode: "unknown" };
    }
    return {
      mode: "ready",
      // Test mode never sends a sketch request — styleTransfer short-circuits to
      // the original photo — so the server reports a full budget it will never
      // spend. Overriding here keeps the store holding only what the server
      // actually said, and 0/0 reads honestly on screen.
      sketch: isAiTestMode ? TEST_MODE_SKETCH : toView(snapshot.sketch),
      analyze: toView(snapshot.analyze),
      blocked: snapshot.blocked,
      resetAt: snapshot.resetAt,
    };
  }, [snapshot]);
}

/**
 * True only when the counter is known AND spent. Gating on the per-action
 * remaining count and nothing else is deliberate: `blocked` reasons like
 * `device` and `service` are per-action on the server, so treating them as a
 * global block would disable the other action too. An occasional request that
 * the server refuses costs nothing — a refused request consumes no quota.
 */
export function isActionSpent(
  view: AiQuotaView,
  action: "sketch" | "analyze",
): boolean {
  return view.mode === "ready" && !view[action].available;
}
