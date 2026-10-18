/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Supabase project that keeps signed-in people's sketches (see .env). */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}
