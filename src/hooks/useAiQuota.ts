import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  expireQuotaSnapshot,
  getQuotaSnapshot,
  subscribeQuota,
  type QuotaBlockedReason,
  type QuotaCounter,
  type QuotaRegion,
} from "../services/aiQuotaStore";
import {
  clearSketchLedger,
  getPendingSketchCount,
  getSketchLedgerVersion,
  subscribeSketchLedger,
} from "../services/sketchLedger";
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
      region: QuotaRegion;
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
 * Folds the requests this client has already sent into the server's numbers.
 * A drawing takes 30-60 seconds, so without this the counter would still read
 * the old value while three of them are in flight.
 *
 * Clamped at the limit: between the response being recorded and its ticket
 * being settled a few microtasks later, one request is briefly counted twice,
 * and "4/3" would read as a bug rather than as the blink it is.
 */
function withPending(counter: QuotaCounter, pending: number): QuotaCounterView {
  const used = Math.min(counter.used + pending, counter.limit);
  const remaining = Math.max(counter.limit - used, 0);
  return { used, limit: counter.limit, remaining, available: remaining > 0 };
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
  // Subscribed on the version rather than the count, so no ledger transition can
  // fail to re-render; the number this view actually needs is then read fresh
  // below, which is also what keeps it an honest `useMemo` dependency.
  useSyncExternalStore(subscribeSketchLedger, getSketchLedgerVersion);
  const pendingSketches = getPendingSketchCount();

  // A session left open across the 09:00 KST reset would otherwise keep showing
  // yesterday's exhausted counters. The delay is at most 24h, comfortably under
  // setTimeout's ~24.8 day ceiling.
  useEffect(() => {
    if (snapshot === null) {
      return;
    }
    const expire = () => {
      expireQuotaSnapshot(Date.now());
      // Yesterday's tickets stop meaning anything at the same moment; keeping
      // them would carry a spent count into the new day.
      clearSketchLedger();
    };
    const msUntilReset = Date.parse(snapshot.resetAt) - Date.now();
    if (msUntilReset <= 0) {
      expire();
      return;
    }
    const timer = setTimeout(expire, msUntilReset);
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
      // spend, and no ticket is ever claimed. Overriding here keeps the store
      // holding only what the server actually said, and 0/0 reads honestly.
      sketch: isAiTestMode
        ? TEST_MODE_SKETCH
        : withPending(snapshot.sketch, pendingSketches),
      // No ledger for analysis: `useDiaryAnalysis` already reuses the in-flight
      // promise and caches by input signature, and its round trip is seconds
      // rather than a minute, so the counter is never meaningfully stale.
      analyze: toView(snapshot.analyze),
      blocked: snapshot.blocked,
      region: snapshot.region,
      resetAt: snapshot.resetAt,
    };
  }, [snapshot, pendingSketches]);
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

/**
 * True when the server refuses this caller's country. Unlike the per-action
 * budgets this is global and does not reset overnight, so both operations are
 * gated on it and the wording has to differ from "내일 아침 9시부터".
 */
export function isRegionBlocked(view: AiQuotaView): boolean {
  return view.mode === "ready" && !view.region.allowed;
}
