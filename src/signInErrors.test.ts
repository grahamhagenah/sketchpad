import { describe, expect, it } from 'vitest'
import { passwordMessage, signInMessage } from './signInErrors'

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

describe('password messages', () => {
  it('says plainly what went wrong', () => {
    expect(passwordMessage('invalid_credentials')).toMatch(/don’t match/)
    expect(passwordMessage('email_not_confirmed')).toMatch(/Confirm your email/)
    expect(passwordMessage('user_already_exists')).toMatch(/already an account/)
    expect(passwordMessage('weak_password')).toMatch(/longer password/)
    expect(passwordMessage(undefined, 429)).toMatch(/Too many tries/)
    expect(passwordMessage('something_new')).toMatch(/couldn’t reach your account/)
  })
})
