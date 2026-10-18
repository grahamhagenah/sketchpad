/**
 * What to tell someone when signing in by email goes wrong, from what
 * Supabase says (its error code, and the HTTP status): in plain words, with
 * what to do about it, rather than its own terse message.
 */
export function signInMessage(code: string | undefined, status?: number): string {
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return 'Too many sign-in emails were sent just now. Try again in an hour.'
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'That doesn’t look like an email address. Check it and try again.'
  if (code === 'email_address_not_authorized') return 'Sign-in emails can’t be sent to that address yet. Try again later.'
  if (code === 'otp_expired' || code === 'access_denied') return 'That sign-in link has expired or was already used. Send yourself a new one.'
  return 'Bounce couldn’t send the link. Check your connection and try again.'
}

/** The same, for signing in or up with a password, setting one, or asking to reset it. */
export function passwordMessage(code: string | undefined, status?: number): string {
  if (code === 'invalid_credentials') return 'That email and password don’t match. Check them, or reset your password.'
  if (code === 'email_not_confirmed') return 'Confirm your email first: tap the link we sent when you made the account.'
  if (code === 'user_already_exists' || code === 'email_exists') return 'There’s already an account for that email. Sign in instead, or reset its password.'
  if (code === 'weak_password') return 'Choose a longer password: at least 8 characters.'
  if (code === 'same_password') return 'That’s the password you have already.'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) return 'Too many tries just now. Wait a while and try again.'
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'That doesn’t look like an email address. Check it and try again.'
  return 'Bounce couldn’t reach your account. Check your connection and try again.'
}
