# Prompts

All LLM prompt texts for the `diary-ai` Edge Function live here — one file
per prompt, as plain TypeScript content modules (a single exported template
literal, no logic). To change a prompt, edit only the text between the
backticks; everything there is sent to the model verbatim.

| File                 | Exports           | Used by                                   | Sent as                     |
| -------------------- | ----------------- | ----------------------------------------- | --------------------------- |
| `analysis_prompt.ts` | `ANALYSIS_PROMPT` | `analyze` action (diary + photo analysis) | chat `system` message       |
| `sketch_prompt.ts`   | `SKETCH_PROMPT`   | `sketch` action (photo → colored pencil)  | `images/edits` prompt field |

Both entrypoints (`index.ts` and the debug variant `index_debug.ts`) import
the same modules, so the prompts can never diverge between them.

## Editing rules

- Keep the word "JSON" and the key list inside `ANALYSIS_PROMPT`: the chat
  call uses `response_format: json_object` (OpenAI rejects the request when
  the prompt does not contain "JSON"), and on the local Ollama path the
  prompt text may be the only thing enforcing the JSON shape.
- Keep these files free of imports and logic so they stay safe to share
  between entrypoints.

## Deploying

Content modules are regular imports, so they bundle on every deploy path —
no `static_files` config and no Docker requirement:

- **Dashboard** (the team's usual path): in the Functions editor, create or
  update these files alongside `index.ts` (add a file named
  `prompts/analysis_prompt.ts`, etc.). Keep "Enforce JWT Verification" OFF —
  dashboard deploys ignore `config.toml`, and this function must stay
  public (abuse control lives inside the function).
- **CLI**: `npx supabase functions deploy diary-ai` works unchanged and
  honors `config.toml`.
