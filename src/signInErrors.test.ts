import { describe, expect, it } from 'vitest'
import { signInMessage } from './signInErrors'

describe('telling someone why signing in went wrong', () => {
  it('says to wait when too many emails were sent', () => {
    expect(signInMessage('over_email_send_rate_limit', 429)).toMatch(/Try again in an hour/)
    expect(signInMessage(undefined, 429)).toMatch(/Try again in an hour/)
  })

  it('says a link has expired, from the address it comes back to', () => {
    expect(signInMessage('otp_expired')).toMatch(/expired or was already used/)
  })

  it('says to check an email that isn’t one', () => {
    expect(signInMessage('email_address_invalid')).toMatch(/doesn’t look like an email/)
  })

  it('falls back to a general message', () => {
    expect(signInMessage('something_new', 500)).toMatch(/couldn’t send the link/)
  })
})
