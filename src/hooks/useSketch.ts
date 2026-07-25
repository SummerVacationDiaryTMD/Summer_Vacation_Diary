import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { refreshAiQuota } from "./useAiQuota";
import { putCachedSketch } from "../services/sketchCache";
import {
  getSketchLedgerVersion,
  hasSketchTicket,
  isSketchTicketSettled,
  subscribeSketchLedger,
} from "../services/sketchLedger";
import {
  isSketchAiConnected,
  isSketchErrorRetryable,
  isSketchOutcomeUnverified,
  sketchCauseMessage,
  sketchErrorMessage,
  transferPhotoToSketch,
} from "../services/styleTransfer";
import type { DiaryDraft } from "./useDiaryDraft";

// Shown when the daily budget is already spent, so no request is ever made.
const QUOTA_SPENT_MESSAGE = sketchCauseMessage("sketch-daily-limit-exceeded");

export type SketchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; sketchDataUrl: string }
  | {
      status: "error";
      message: string;
      /** false when retrying the same photo can never succeed (moderation). */
      retryable: boolean;
    };

// Sketches are ~200-400KB each, so the in-memory cache stays small. It only
// covers "picked photo A, tried B, went back to A" within one session —
// across sessions the draft's persisted sketchDataUrl is the cache.
const CACHE_MAX_ENTRIES = 2;

/**
 * Runs the stage-3 photo → drawing conversion while `active` is true.
 *
 * The conversion starts the moment the user leaves the upload step (a
 * commitment signal — no API spend for abandoned photos) and runs while they
 * write, so the 30-60s the image model needs is hidden behind typing time.
 * The finished sketch is written INTO the draft, which both persists it and
 * makes "photo changed → sketch cleared" a single-source-of-truth rule that
 * App.tsx enforces at the moment the photo changes.
 */
export function useSketch(
  draft: Pick<DiaryDraft, "photoDataUrl" | "sketchDataUrl">,
  updateDraft: (patch: Partial<DiaryDraft>) => void,
  active: boolean,
  /**
   * False only when the budget is known to be spent — counting the requests
   * this client has already dispatched, not just the ones the server has
   * answered. It is a courtesy gate that saves a round trip, never the
   * enforcement point: the server's atomic consume decides, and it must stay
   * true while the budget is unknown so a slow first quota fetch cannot lock a
   * user out of their own diary.
   */
  allowed: boolean,
  /** SHA-256 of the file the photo came from; keys the cross-session cache. */
  sourceHash: string | null,
) {
  const { photoDataUrl, sketchDataUrl } = draft;

  // Errors remember which photo they belong to, so an error for an abandoned
  // photo is never shown against a newly picked one.
  const [error, setError] = useState<{
    source: string;
    message: string;
    retryable: boolean;
  } | null>(null);
  // Bumping this re-runs the effect for the same inputs (explicit retry).
  const [attempt, setAttempt] = useState(0);
  const cacheRef = useRef(new Map<string, string>());
  // One in-flight request PER PHOTO. A single slot used to mean that leaving
  // photo A for B and coming back to A started a second paid request for A
  // while the first was still running.
  const pendingRef = useRef(new Map<string, Promise<string>>());
  const requestIdRef = useRef(0);

  // Any ledger change can flip this photo's entitlement or the budget it is
  // measured against, so the hook has to re-render on it.
  useSyncExternalStore(subscribeSketchLedger, getSketchLedgerVersion);
  // A photo that already holds a ticket stays allowed even once the budget hits
  // zero: otherwise the third drawing would flip to "횟수를 다 써서" while its
  // own request is still running.
  const canRequest = allowed || hasSketchTicket(photoDataUrl);

  // The resolve handlers below need the CURRENT photo, not the one captured
  // when the request started — a ref avoids re-subscribing them on each edit.
  const photoRef = useRef(photoDataUrl);
  useEffect(() => {
    photoRef.current = photoDataUrl;
  }, [photoDataUrl]);

  useEffect(() => {
    if (
      !active ||
      !canRequest ||
      photoDataUrl === null ||
      sketchDataUrl !== null
    ) {
      return;
    }
    // A failed conversion must NOT auto-retry on step navigation — each
    // attempt costs an API call, so only the explicit retry button (which
    // clears `error` and bumps `attempt`) may fire again.
    if (error !== null && error.source === photoDataUrl) {
      return;
    }
    // Backstop for "one photo, one paid request". Every settled outcome today
    // also leaves either a sketch or a non-retryable error, so this is
    // unreachable — but it makes the rule true by construction rather than by
    // a chain of three other invariants holding.
    if (isSketchTicketSettled(photoDataUrl)) {
      return;
    }

    const cached = cacheRef.current.get(photoDataUrl);
    if (cached !== undefined) {
      // Invalidate any in-flight request for an abandoned photo: without this
      // bump, its late result could race with the cached one being committed.
      requestIdRef.current += 1;
      updateDraft({ sketchDataUrl: cached });
      return;
    }

    // Stale-response guard: only the newest effect run may commit state.
    const requestId = ++requestIdRef.current;

    // Reuse the in-flight request for this exact photo (the user navigated back
    // and forth mid-conversion, or swapped away and returned) instead of paying
    // twice. `transferPhotoToSketch` is what claims the ledger ticket, so not
    // calling it again is also what keeps the count honest.
    const source = photoDataUrl;
    let pending = pendingRef.current.get(source);
    if (pending === undefined) {
      pending = transferPhotoToSketch(source);
      pendingRef.current.set(source, pending);
    }
    const request = pending;

    request
      .then((sketch) => {
        if (pendingRef.current.get(source) === request) {
          pendingRef.current.delete(source);
        }
        // The sketch is valid for the photo that produced it, so cache it
        // even if superseded — the user may revert to that photo.
        cacheRef.current.set(source, sketch);
        // Persist only real conversions. In test mode this "sketch" is the
        // untouched photo, and offering to reuse that later would promise a
        // drawing that was never made.
        if (isSketchAiConnected) {
          putCachedSketch(sourceHash, sketch);
        }
        if (cacheRef.current.size > CACHE_MAX_ENTRIES) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey !== undefined) {
            cacheRef.current.delete(oldestKey);
          }
        }
        // Two guards: the photo must still be the one this sketch was drawn
        // from (photo swaps don't bump requestId while on the upload step,
        // where this effect is inactive), and no newer run may be superseded.
        if (photoRef.current !== source) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        updateDraft({ sketchDataUrl: sketch });
      })
      .catch((cause: unknown) => {
        if (pendingRef.current.get(source) === request) {
          pendingRef.current.delete(source);
        }
        if (photoRef.current !== source) {
          return;
        }
        if (requestId !== requestIdRef.current) {
          return;
        }
        // These failures carried no response body, so no usage snapshot came
        // back with them and the ticket was released on a guess. A client-side
        // timeout in particular does not cancel the Edge Function, so the call
        // may still have succeeded and stayed charged — only a fresh read can
        // tell us.
        if (isSketchOutcomeUnverified(cause)) {
          void refreshAiQuota();
        }
        setError({
          source,
          message: sketchErrorMessage(cause),
          retryable: isSketchErrorRetryable(cause),
        });
      });
  }, [
    active,
    attempt,
    canRequest,
    error,
    photoDataUrl,
    sketchDataUrl,
    sourceHash,
    updateDraft,
  ]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((count) => count + 1);
  }, []);

  let state: SketchState;
  if (photoDataUrl === null) {
    state = { status: "idle" };
  } else if (sketchDataUrl !== null) {
    state = { status: "success", sketchDataUrl };
  } else if (!canRequest) {
    // Derived rather than stored: when the budget comes back the state heals on
    // its own, and a stale "no budget" error can never outlive the reset. It
    // also outranks any remembered error, so no retry button is offered for
    // something that cannot succeed.
    state = { status: "error", message: QUOTA_SPENT_MESSAGE, retryable: false };
  } else if (error !== null && error.source === photoDataUrl) {
    state = {
      status: "error",
      message: error.message,
      retryable: error.retryable,
    };
  } else if (isSketchTicketSettled(photoDataUrl)) {
    // Paired with the effect's backstop above: a photo whose request was
    // charged for but left neither a sketch nor an error would otherwise sit on
    // "loading" forever, since nothing is allowed to dispatch for it again.
    state = {
      status: "error",
      message: sketchCauseMessage("invalid-response"),
      retryable: false,
    };
  } else if (active) {
    state = { status: "loading" };
  } else {
    state = { status: "idle" };
  }

  return { state, retry };
}
