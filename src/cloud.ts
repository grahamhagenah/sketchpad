import { createClient } from '@supabase/supabase-js'
import { create } from 'zustand'

/**
 * The cloud copy of signed-in people's sketches, on Supabase (the project in
 * .env, set up by supabase/schema.sql). Signing in is optional: without it,
 * or without the project's settings, Bounce works as ever, on the device.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        // The sign-in link carries the session itself, so it works in whatever browser the email app opens it in.
        flowType: 'implicit',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

/** Who's signed in, by email; null when no one is. `ready` once that's known (a moment after load). */
export const useAccount = create<{ email: string | null; ready: boolean }>(() => ({ email: null, ready: !supabase }))

supabase?.auth.onAuthStateChange((_event, session) => {
  useAccount.setState({ email: session?.user.email ?? null, ready: true })
  // Back from a sign-in link: the session it carried is kept; take it off the address.
  if (session && location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search)
})

/** Emails a link that signs in (making the account the first time), back to this page. */
export async function sendSignInLink(email: string) {
  if (!supabase) throw new Error('Signing in isn’t set up here.')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: location.origin + location.pathname },
  })
  if (error) throw error
}

export async function signOut() {
  await supabase?.auth.signOut()
}
