# `diary-ai` prompt modules

All LLM prompt texts for this Edge Function live in this directory, next to
`index.ts` — one file per prompt, as plain TypeScript content modules (a
single exported template literal, no logic). To change a prompt, edit only
the text between the backticks; everything there is sent to the model
verbatim.

| File                 | Exports           | Used by                                   | Sent as                     |
| -------------------- | ----------------- | ----------------------------------------- | --------------------------- |
| `prompt_analysis.ts` | `ANALYSIS_PROMPT` | `analyze` action (diary + photo analysis) | chat `system` message       |
| `prompt_sketch.ts`   | `SKETCH_PROMPT`   | `sketch` action (photo → colored pencil)  | `images/edits` prompt field |

`index.ts` is the only entrypoint and imports both modules directly. (There
used to be a second, debug-only entrypoint sharing them; it was removed once
`index.ts` grew its own request logging.)

## Editing rules

- Keep the word "JSON" and the key list inside `ANALYSIS_PROMPT`: the chat
  call uses `response_format: json_object` (OpenAI rejects the request when
  the prompt does not contain "JSON"), and on the local Ollama path the
  prompt text may be the only thing enforcing the JSON shape.
- Keep these files free of imports and logic. They are pasted by hand into
  the Dashboard editor, and anything beyond a template literal turns a
  prompt edit into a code review.

## Deploying

Content modules are regular imports, so they bundle on every deploy path —
no `static_files` config and no Docker requirement:

- **Dashboard** (the team's usual path): in the Functions editor, create or
  update `prompt_analysis.ts` and `prompt_sketch.ts` at the same level as
  `index.ts` — no subdirectory. Deploying `index.ts` alone fails, because it
  imports both. This README is documentation only; do not create it there.
  Keep "Enforce JWT Verification" OFF — dashboard deploys ignore
  `config.toml`, and this function must stay public (abuse control lives
  inside the function).
- **CLI**: `npx supabase functions deploy diary-ai` works unchanged and
  honors `config.toml`.
