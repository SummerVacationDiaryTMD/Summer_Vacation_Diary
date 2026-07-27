# Sketch Result Drop — Fix Specification

Implementation spec for the bug described (for the team, in Korean) in
[`SKETCH_BUG_FIX_REPORT.md`](./SKETCH_BUG_FIX_REPORT.md). This document is
self-contained: everything needed to implement and verify the fix is here.

- **Scope:** `src/hooks/useSketch.ts` only. No server, migration, or deploy-path
  changes. `src/services/styleTransfer.ts` and `src/services/sketchLedger.ts`
  must NOT be modified (see §2.1 for why).
- **Introduced by:** commit `5530c6e` (per-photo in-flight map + sketch ledger +
  settled backstop) interacting with the pre-existing global request-id guard.

## 1. The defect

### 1.1 Deterministic reproduction

1. Pick photo A, leave the upload step (`일기 쓰러 가기`) → sketch request A
   dispatches (30–60 s).
2. Go back (`사진 변경`), pick photo B, leave the upload step → request B
   dispatches. The hook's global `requestIdRef` is now 2.
3. Go back again, re-pick photo A and confirm the crop **without adjusting it**
   (the default crop is deterministic, so the cropped data URL is byte-identical
   to step 1's and keys the same ledger/in-flight entries).
4. **Stay on the upload step** until request A completes (watch the Supabase
   log), then press `일기 쓰러 가기`.

Result: the drawing is never committed to the draft. The preview shows
`알 수 없는 이유로 그림을 못그렸어요.` with no retry button, and no path exists
to either re-request photo A or use the drawing — which by then is sitting in
both the in-memory cache and the localStorage sketch cache.

If A's response instead arrives *after* step 4's effect run, that run attaches a
fresh handler carrying the current request id and the commit succeeds — which is
why the bug is timing-dependent in normal use.

### 1.2 Root cause chain

All line numbers refer to the current `main` (`c0646b4`).

| Location | Role | Defect |
| --- | --- | --- |
| `useSketch.ts:88`, `:138` | `requestIdRef`, one monotone counter shared by ALL photos; each dispatching effect run bumps it and captures the new value | Dispatching photo B permanently marks photo A's already-attached handler stale |
| `useSketch.ts:175-180` | Resolve-handler guards: photo still current, then `requestId === requestIdRef.current` | A's late resolution passes the photo check (the current photo IS A again) but fails the id check → commit silently dropped |
| `styleTransfer.ts:164` | `settleSketchTicket()` runs at promise resolution, before the hook decides whether to commit | Ledger records "photo A: charged and done" while the draft has nothing — split brain |
| `useSketch.ts:124-126` | Settled backstop in the effect, placed BEFORE the `cacheRef` lookup at `:128` | Every later effect run for photo A returns early; the cached drawing is unreachable forever, and no re-dispatch is possible |
| `useSketch.ts:240-248` | Derived state for "settled but no sketch and no error" | Renders the `invalid-response` cause with `retryable: false` → `PreviewStep.tsx:622` renders no retry button |

The invariant claimed in the comment at `useSketch.ts:120-123` ("Every settled
outcome today also leaves either a sketch or a non-retryable error, so this is
unreachable") is exactly what this interleaving breaks.

## 2. Design decisions

### 2.1 Keep `settleSketchTicket` in the service layer

`styleTransfer.ts` owns the ticket lifecycle so that "one photo, one paid
request" holds without every caller remembering to count (its own stated
design). Moving settle into the hook would couple the ledger to React timing and
re-open the double-billing bug the ledger was built to fix. Instead, the hook is
changed so a settled-but-uncommitted photo can always heal (§3.3, §3.4).

### 2.2 Replace the global request id with per-key guards

In-flight requests are deduplicated **per photo** (`pendingRef` is a
`Map<photoDataUrl, Promise>`), so the commit decision must be keyed the same
way. A global monotone id vetoes legitimate late commits for keys it was never
about. `requestIdRef` is deleted entirely. What each of its former protections
is replaced by:

| `requestIdRef` used to prevent | Replacement |
| --- | --- |
| Committing a sketch for a photo the user has left | `photoRef.current !== source` guard (already exists, unchanged) |
| A late in-flight result overwriting a cache-path commit (`:130-132`) | New `sketchRef.current !== null` guard: never overwrite an existing draft sketch. Both values for one key are identical anyway (one live promise per key), so even the worst case is a benign same-value write — see §5.1 |
| An older effect run's handler racing a newer run's handler for the SAME photo | Both handlers reuse the same per-key promise and would commit the same value; the first commit wins, the second is blocked by `sketchRef` |

## 3. Normative changes — `src/hooks/useSketch.ts`

Keep the effect's dependency array and the imports unchanged. Match the file's
existing comment style (comments explain *why*, not *what*). The stale comments
listed in §3.5 MUST be rewritten — they describe the old mechanism.

### 3.1 Add a committed-sketch mirror ref; delete `requestIdRef`

Next to the existing `photoRef` block (`:100-103`):

```ts
// The resolve handlers below need the CURRENT photo and the CURRENT committed
// sketch, not the ones captured when the request started — refs avoid
// re-subscribing them on each edit.
const photoRef = useRef(photoDataUrl);
useEffect(() => {
  photoRef.current = photoDataUrl;
}, [photoDataUrl]);
const sketchRef = useRef(sketchDataUrl);
useEffect(() => {
  sketchRef.current = sketchDataUrl;
}, [sketchDataUrl]);
```

Delete `const requestIdRef = useRef(0);` (`:88`) and every read/write of it
(`:132`, `:138`, `:178-180`, `:190-192`).

### 3.2 Commit through one helper that also updates the mirror synchronously

The mirror effect only runs after React re-renders, so a same-tick late
resolution could still see `sketchRef.current === null`. Setting the ref at the
commit site closes that window without waiting for the render:

```ts
// Synchronous mirror update: a resolution landing in the same tick as this
// commit must already see the sketch and stand down.
const commitSketch = useCallback(
  (sketch: string) => {
    sketchRef.current = sketch;
    updateDraft({ sketchDataUrl: sketch });
  },
  [updateDraft],
);
```

Use `commitSketch(...)` at both commit sites (cache path and resolve handler).
If declared inside the component body (recommended), add it to the effect's
dependency array in place of nothing new — `useCallback` keeps it stable, so the
array's behavior is unchanged.

### 3.3 Reorder the effect: cache lookup BEFORE the settled backstop

New order inside the effect (guards at `:105-119` stay first and unchanged):

```ts
// Serve this session's cache first. This must run BEFORE the settled backstop:
// a settled photo whose drawing only ever reached the cache (its commit was
// superseded at resolution time) heals here on the next run instead of
// deadlocking behind "already handled".
const cached = cacheRef.current.get(photoDataUrl);
if (cached !== undefined) {
  commitSketch(cached);
  return;
}

// Backstop for "one photo, one paid request": a settled photo with nothing in
// the cache has genuinely lost its result, and dispatching again would pay a
// second time for it.
if (isSketchTicketSettled(photoDataUrl)) {
  return;
}
```

(The old cache path's `requestIdRef.current += 1;` bump is gone with the
counter; its job is now done by `commitSketch` setting `sketchRef`.)

### 3.4 Per-key guards in both promise handlers

Resolve handler — replace the two guards at `:175-180` and the commit at `:181`:

```ts
// Commit iff this drawing still belongs to the CURRENT photo and nothing has
// been committed for it yet — keyed the same way as the in-flight map, so a
// dispatch for a DIFFERENT photo can no longer strand this one's result.
if (photoRef.current !== source) {
  return;
}
if (sketchRef.current !== null) {
  return;
}
commitSketch(sketch);
```

Catch handler — replace the guards at `:187-192` and move the unverified-outcome
refresh ABOVE the photo guard (the counter is global; it must be re-read no
matter which photo is showing when an unverified failure lands):

```ts
// These failures carried no response body, so the ticket was released on a
// guess and the on-screen counter may be wrong REGARDLESS of which photo is
// currently showing — refresh before deciding whether this error is displayable.
if (isSketchOutcomeUnverified(cause)) {
  void refreshAiQuota();
}
if (photoRef.current !== source) {
  return;
}
if (sketchRef.current !== null) {
  return;
}
setError({
  source,
  message: sketchErrorMessage(cause),
  retryable: isSketchErrorRetryable(cause),
});
```

The `pendingRef` delete lines at the top of both handlers stay exactly as they
are.

### 3.5 Cache-aware derived state for the settled branch

Replace the state at `:240-248`:

```ts
} else if (isSketchTicketSettled(photoDataUrl)) {
  // A settled photo whose drawing is still in the session cache is about to be
  // committed by the effect — that frame must read as loading, not as failure.
  // With nothing cached the result is genuinely gone: charged for, but neither
  // a sketch nor an error survived, and nothing may dispatch again.
  state = cacheRef.current.has(photoDataUrl)
    ? { status: "loading" }
    : {
        status: "error",
        message: sketchCauseMessage("invalid-response"),
        retryable: false,
      };
}
```

### 3.6 Comments that MUST be rewritten

- `:84-87` (`pendingRef`) — keep; still accurate.
- `:120-123` (settled backstop "unreachable") — rewrite: reachable only if a
  settled photo's drawing was evicted from the session cache, which §5.3 shows
  cannot happen while that photo is current; state why it is kept as a backstop.
- `:130-132` (cache-path bump rationale) — delete with the bump.
- `:137` ("Stale-response guard: only the newest effect run may commit") —
  delete; the sentence describes the removed mechanism.
- `:172-174` ("Two guards: … photo swaps don't bump requestId while on the
  upload step …") — replaced by the new comment in §3.4. This old comment
  half-documented the bug's window without drawing the conclusion.

## 4. Invariants that must hold after the change

1. **One photo, one paid request.** Dedup still comes from `pendingRef` +
   ledger tickets + the (reordered) settled backstop. Nothing in this fix adds a
   dispatch site.
2. **No auto-retry on navigation.** A stored error for the current photo still
   short-circuits the effect (`:117-119`, unchanged); only the explicit retry
   button clears it.
3. **Never overwrite a committed sketch.** New `sketchRef` guard; also protects
   the reused-sketch path (`reusedSketchDataUrl` in `App.tsx:523-534`).
4. **No cross-photo contamination.** `photoRef.current !== source` unchanged.
5. **Quota gating unchanged.** `canRequest`, `QUOTA_SPENT_MESSAGE`, and the
   region/budget flows are untouched.

## 5. Edge cases already analyzed (do not re-derive)

1. **Benign same-value double commit.** Cache-path commit and a same-tick late
   resolution for the same key both carry the same sketch string (one live
   promise per key at any time), and `commitSketch`'s synchronous mirror blocks
   the second write anyway.
2. **Pre-existing paint-window micro-race (out of scope).** `photoRef` is
   mirrored in a passive effect, so a resolution landing between a commit of a
   photo *change* and that effect could still read the old photo. This window
   predates this fix, is unrelated to it, and requires a same-tick photo swap;
   do not attempt to fix it here.
3. **Cache eviction cannot strand the current photo.** `cacheRef` evicts the
   oldest insertion beyond 2 entries, but the current photo's entry is always
   the newest insert at its own resolution, and returning to an older photo
   always goes through re-picking — where `PhotoUploadStep`'s
   `getCachedSketch(sourceHash)` reuse dialog recovers it from localStorage.
4. **Mock/test mode flows through the same hook path** (`transferPhotoToSketch`
   short-circuits above the paid request), so the fix applies there too and can
   be tested offline.
5. **StrictMode double effects** only duplicate handler attachment; with
   per-key guards both handlers are idempotent.

## 6. Acceptance

### 6.1 Commands

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json   # NEVER `npx tsc`
npm run lint
```

### 6.2 Manual matrix

Offline testing tip: mock mode (no `VITE_SUPABASE_*` set) uses a 1.5 s fake
delay; temporarily raise `MOCK_DELAY_MS` in `styleTransfer.ts` to ~30 000 while
testing to make the race windows reachable by hand, and revert it afterwards.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | §1.1 repro, exactly | Drawing A appears in the preview; server receives exactly 2 sketch requests |
| 2 | A → B → back to A quickly, before either resolves | One request per photo (no duplicate dispatch); A's drawing commits on arrival |
| 3 | Single photo, no swapping | Unchanged happy path |
| 4 | Force a failure (kill network mid-request) on the current photo | Error message + retry button; navigating steps does not re-dispatch; retry does |
| 5 | Failure arriving while a DIFFERENT photo is current | No error shown for the current photo; quota counter still refreshes if the failure was unverified (timeout/network/invalid-response) |
| 6 | Daily sketch budget exhausted | `오늘 그림 그리기 횟수를 다 써서…` message, no dispatch (unchanged) |
| 7 | Re-pick a photo whose drawing exists in localStorage cache | `이미 그린 그림이 있어요` dialog, both choices behave as before |
| 8 | Reused sketch present, then swap photos and back | Reused sketch never overwritten by any late resolution |

## 7. Out of scope

- **Per-photo error memory.** The single `error` slot still only records a
  failure for the photo that is current when it lands; a failure for an
  abandoned photo is forgotten, and returning to that photo re-dispatches
  (spending a fresh ticket). Known limitation, unchanged by this fix; a
  `Map<source, error>` is a possible follow-up.
- Any server/Edge Function/migration change, any UI copy change, and the §5.2
  micro-race.

## 8. Already-affected sessions

No migration or remote action needed. The ledger is in-memory, so the deadlock
does not survive an app restart; within a stuck session, re-picking the same
photo recovers the drawing through the localStorage reuse dialog. The fix
removes the trap going forward; nothing persisted needs cleaning up.
