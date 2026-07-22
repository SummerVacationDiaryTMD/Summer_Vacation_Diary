/// <reference types="vite/client" />

// Typed env vars: without this augmentation `import.meta.env.VITE_*` is `any`,
// which would let typos through the type checker silently.
interface ImportMetaEnv {
  /** Public Supabase project URL. Both values absent → local mock mode. */
  readonly VITE_SUPABASE_URL?: string;
  /** Public sb_publishable_* key; database access must still be protected by RLS. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Defaults to true: analyze only and skip image generation. */
  readonly VITE_AI_TEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}
