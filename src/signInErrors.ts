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
