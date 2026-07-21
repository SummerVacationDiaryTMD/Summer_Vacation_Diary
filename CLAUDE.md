# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A three-person team entry (EHoon, idonmin, kimjun; changes land via GitHub PRs) for the Apps in Toss vibecoding challenge, deadline 2026-07-29. The product is a summer-vacation picture diary (그림일기) mini-app that runs inside the Toss app as a WebView. The runnable app and its configuration live at the repository root alongside planning and reference docs.

Hard challenge constraint: the word "AI" must never appear in the app name. `appName` stays `summer-vacation-diary`; the user-facing display name ("나의 여름방학일기") and icon are configured in the Apps in Toss console, not in this repo.

## Commands

Run everything from the repository root:

```bash
npm install        # depends on the "overrides" block in package.json — see below
npm run dev        # plain Vite dev server; Toss-only APIs fall back (see runtime notes)
npm run build      # vite build + ait build → dist/ and *.ait (both gitignored)
npm run deploy     # ait deploy — needs a console API key from apps-in-toss.toss.im
npm run lint       # ESLint
npm run format     # Prettier
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json   # typecheck (no npm script for it)
```

- Never run `npx tsc` — it can silently resolve to an unrelated deprecated npm package; use the local binary as above.
- There is no test framework.
- `npm install` fails with a peer-dependency conflict unless the `overrides` block in `package.json` stays in place: it forces `@toss/tds-mobile-ait` to accept the project's `@apps-in-toss/web-framework` version (the `$package-name` syntax references the project's own dependency, so no version string is duplicated). Do not remove it.

## Root docs and how much to trust them

- `AI_weekly_picture_diary_2.md` — the product spec; source of the upload/validation rules and the AI response shape. Its Python/FastAPI backend architecture was never built (the app is frontend-only), and where spec and code disagree — e.g. diary max length is 55 chars (11×5 manuscript grid) in code vs 500 in the spec — the code wins.
- `explain.md` — thorough architecture walkthrough, but written before the SDK migration and Stages 3–4: it claims sketch conversion and image composition are unimplemented (both exist now) and references `granite.config.ts` and `docs/skills/` (both deleted). Trust its data-flow reasoning, not its feature status or file inventory.
- `TO_DO_LIST.md` — pending feature checklist. Note: the commit "Add : 참 잘했어요 도장" only added that item to this list — no stamp feature exists in `src/` yet.
- `README.md` — env-var setup and deploy links.

## Architecture

React 18 + TypeScript + Vite 6 on `@apps-in-toss/web-framework` 3.0.0-beta — the WebView track of Apps in Toss (this is a web app; the React Native/Granite track was deliberately not used). UI is TDS Mobile (`@toss/tds-mobile` + `@toss/tds-mobile-ait`; the app is wrapped in `TDSMobileAITProvider` in `main.tsx`). App config is `apps-in-toss.config.ts` (SDK 3.x style). No router, no state library, no backend, no database.

- `src/App.tsx` owns a single `step` state machine — `upload → write → preview` — and coordinates all hooks and services; there are no routes.
- Every input funnels into one `DiaryDraft` object (`hooks/useDiaryDraft.ts`), persisted to localStorage key `summer-vacation-diary:draft:v2` (400ms debounce, immediate flush on page hide, corrupt data recovers to defaults). Photos live inside the draft as base64 JPEG data URLs, downscaled on upload to ≤1280px / quality 0.85 (`utils/image.ts`) to fit localStorage quota.
- `src/services/` is the external-AI boundary, and every service is mock-first: without the two `VITE_SUPABASE_*` public settings the app runs deterministic local mocks (체험 모드), so the full flow works offline. With Supabase configured, both operations call the `diary-ai` Edge Function; the OpenAI key and model settings never ship in the client.
  - `diaryAnalysis.ts` — requests vision analysis returning keywords, emotions, highlight words/sentences, and a teacher-style comment capped at 50 characters, including spaces; preview and export display up to two lines with an ellipsis on overflow. Validation drops any highlight target that is not literally a substring of the diary text.
  - `styleTransfer.ts` — requests photo → colored-pencil sketch conversion through the Edge Function.
  - `supabaseEdge.ts` — shared typed fetch boundary for the `diary-ai` Edge Function.
  - `diaryExport.ts` — composes the final keepsake image on a canvas (`utils/diaryImage.ts`) and saves it to the device.
- Every photo pick/replacement first shows an explicit transfer-and-analysis consent modal. It warns about sensitive data and explains the Supabase/OpenAI transfer and device/IP abuse controls.
- The versioned `supabase/functions/diary-ai/` source enforces atomic per-device and per-IP short-window and daily quotas through the migration in `supabase/migrations/`. Raw identifiers are salted and hashed before storage; limit values live together in the Function's `USAGE_LIMITS` constant.
- The completed-image modal has two primary actions: save the JPEG, or open Toss/OS sharing with a promotional message and Toss app link. The native share sheet lists the messaging and SNS apps installed on the device; no diary image is uploaded to create a public result URL.
- Sketch generation is kicked off when the user leaves the upload step, hiding its latency behind diary writing. Failed generations surface an explicit retry button; never auto-retry on navigation.
- `hooks/useDiaryAnalysis.ts` keys everything on an input signature: result cache, in-flight promise reuse, and request-id checks prevent duplicate API calls and stale responses overwriting newer input.
- `PreviewStep.tsx` renders the diary card as an 11×5 manuscript grid (원고지) inside `public/picture-diary-frame.png`, overlaying circle/wavy-underline annotations from `utils/highlight.ts` as plain React text (no `dangerouslySetInnerHTML`).
- `utils/diaryImage.ts` (canvas compositing) uses a measure-then-size two-pass because resizing a canvas resets its context state, wraps text by code point (`for..of`, not string index), and feature-detects `ctx.roundRect`.

### Toss runtime specifics

- Device save uses `saveBase64Data` (SDK 3.x only): pass bare base64 with the `data:...;base64,` prefix stripped.
- `getOperationalEnvironment()` reads a global injected by the Toss WebView and **throws in a plain browser** — that throw is the intended "not inside Toss" signal. `diaryExport.ts` catches it and falls back to an `<a download>` link, which is how the dev-server flow works.
- `iframe` is forbidden in mini-apps (app review rejects it).
- TDS Mobile's online docs drift from the installed version — verify component props against `node_modules/@toss/tds-mobile*/**/*.d.ts` before use. For platform questions, the apps-in-toss MCP doc-search tools (query in Korean) are available in some sessions.

### OpenAI quirks already encoded in the services

- Chat: use `max_completion_tokens` (not `max_tokens`) and omit `temperature` so reasoning-family model overrides don't reject the request; the prompt must contain the word "JSON" when using the `json_object` response format.
- Images: `gpt-image-1` returns 403 for accounts without organization verification; distinguish 429s by response-body `error.code` (`insufficient_quota` is terminal — don't retry).

## Environment variables

Optional `.env` in the repository root (gitignored); with no Supabase config the app runs in mock mode:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

- Vite inlines all `VITE_*` values into the client bundle, so only the public Supabase URL and publishable key belong there. `OPENAI_API_KEY` is a Supabase Edge Function Secret.
- When adding a `VITE_*` var, declare it in `src/vite-env.d.ts` too (currently only the first two are typed).

## Known pending work

`TO_DO_LIST.md` items (참 잘했어요 stamp, fonts, page-flip effect, album/PDF export, diary features), plus pre-release requirements: deploy the checked-in Supabase proxy/migration, console app registration, and real-device save/share tests.
