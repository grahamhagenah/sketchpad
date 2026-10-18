import { createClient } from '@supabase/supabase-js'
import { create } from 'zustand'
import { passwordMessage, signInMessage } from './signInErrors'

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

/**
 * Who's signed in, by email; null when no one is. `ready` once that's known
 * (a moment after load). `linkError` when a sign-in link came back refused
 * (expired, or used already), to say so where they sign in.
 */
export const useAccount = create<{ email: string | null; ready: boolean; linkError: string | null; recovering: boolean }>(() => ({
  email: null,
  ready: !supabase,
  linkError: linkRefused(),
  // Back from a "reset your password" email: signed in by it, to choose a new one.
  recovering: false,
}))

/** A sign-in link that came back refused leaves why in the address (#error=…&error_code=…): what to tell them, taking it off the address. */
function linkRefused() {
  if (typeof location === 'undefined' || !location.hash.includes('error')) return null
  const params = new URLSearchParams(location.hash.slice(1))
  if (!params.get('error')) return null
  history.replaceState(null, '', location.pathname + location.search)
  return signInMessage(params.get('error_code') ?? params.get('error') ?? undefined)
}

supabase?.auth.onAuthStateChange((event, session) => {
  useAccount.setState({ email: session?.user.email ?? null, ready: true, ...(event === 'PASSWORD_RECOVERY' ? { recovering: true } : {}) })
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
  if (error) throw new Error(signInMessage(error.code, error.status))
  useAccount.setState({ linkError: null })
}

/** The minimum a password needs, as Supabase asks by default (and Bounce asks for a little more). */
export const MIN_PASSWORD = 8

/** Signs in with an email and password. Throws, with what to tell them, if it can't. */
export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Signing in isn’t set up here.')
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(passwordMessage(error.code, error.status))
}

/**
 * Makes an account with a password. Supabase first emails a link to confirm
 * the address is theirs: true if that's been sent (and they sign in once
 * it's tapped), false if they're signed in already.
 */
export async function signUpWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Signing in isn’t set up here.')
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin + location.pathname, data: { has_password: true } } })
  if (error) throw new Error(passwordMessage(error.code, error.status))
  // An address that already has an account comes back with no identities, rather than an error (so addresses can't be fished for): said plainly here.
  if (data.user && data.user.identities?.length === 0) throw new Error(passwordMessage('user_already_exists'))
  return !data.session
}

/** Emails a link to choose a new password, back to this page. */
export async function sendPasswordReset(email: string) {
  if (!supabase) throw new Error('Signing in isn’t set up here.')
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname })
  if (error) throw new Error(passwordMessage(error.code, error.status))
}

/** Sets (or changes) the signed-in account's password. */
export async function setPassword(password: string) {
  if (!supabase) throw new Error('Signing in isn’t set up here.')
  const { error } = await supabase.auth.updateUser({ password, data: { has_password: true } })
  if (error) throw new Error(passwordMessage(error.code, error.status))
  useAccount.setState({ recovering: false })
}

export async function signOut() {
  await supabase?.auth.signOut()
}
