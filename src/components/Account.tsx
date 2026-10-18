import { useCallback, useEffect, useRef, useState } from 'react'
import { MIN_PASSWORD, sendPasswordReset, sendSignInLink, setPassword, signInWithPassword, signOut, signUpWithPassword, supabase, useAccount } from '../cloud'
import { syncSoon, useSync } from '../sync'
import { useDismiss } from '../hooks/useDismiss'
import { useDropBelow } from '../hooks/useDropBelow'

/**
 * The account, by the file button: signed out, signing in by email (a link
 * to tap, no password); signed in, who as, and signing out. Lit up in the
 * accent colour while signed in.
 */
export function AccountButton() {
  const { email, ready, linkError, recovering } = useAccount()
  // Open already when a sign-in link came back refused, to say why.
  const [open, setOpen] = useState(() => !!useAccount.getState().linkError)
  // And when a "reset your password" link signs them in, to choose the new one.
  useEffect(() => {
    if (recovering) setOpen(true)
  }, [recovering])
  const close = useCallback(() => setOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, close, ref)
  const below = useDropBelow(open, ref)
  if (!supabase || !ready) return null

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={`icon-btn account-btn ${email ? 'is-signed-in' : ''}`}
        aria-label={email ? `Account: signed in as ${email}` : 'Sign in'}
        title={email ? `Signed in as ${email}` : 'Sign in'}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </svg>
      </button>
      {open && (
        <div className="menu account-menu" id="account-menu" role="dialog" aria-label="Account" style={below}>
          {email && recovering ? <NewPassword email={email} reset /> : email ? <SignedIn email={email} /> : <SignIn linkError={linkError} />}
          <div className="menu-divider" role="separator" />
          <a className="menu-footnote" href="/about/" target="_blank" rel="noopener">
            About Bounce
          </a>
        </div>
      )}
    </div>
  )
}

function SignedIn({ email }: { email: string }) {
  const sync = useSync()
  const [changing, setChanging] = useState(false)
  // Whether the account has a password yet, or only signs in by email link.
  const hasPassword = useHasPassword()
  return (
    <div className="menu-item account-row">
      <span className="menu-item-title">Signed in</span>
      <span className="menu-item-about account-email">{email}</span>
      {/* Whether this device's songs are in step with the account's. */}
      <span className={`account-sync is-${sync.state}`}>
        {sync.state === 'syncing'
          ? 'Syncing…'
          : sync.state === 'offline'
            ? 'Offline: syncs when you’re back'
            : sync.state === 'error'
              ? 'Couldn’t sync'
              : sync.at
                ? 'Your songs are in sync'
                : 'Saved songs sync to your account'}
        {sync.state === 'error' && (
          <button type="button" className="account-link" onClick={syncSoon} title={sync.error ?? undefined}>
            Try again
          </button>
        )}
      </span>
      <span className="account-actions">
        <button type="button" className="account-link" onClick={() => setChanging(!changing)} aria-expanded={changing}>
          {hasPassword ? 'Change password' : 'Set a password'}
        </button>
        <button type="button" className="account-link" onClick={() => void signOut()} title="Your songs stay on this device too">
          Sign out
        </button>
      </span>
      {changing && <NewPassword email={email} onDone={() => setChanging(false)} />}
    </div>
  )
}

/**
 * Choosing a password for the signed-in account: a first one (signed up by
 * email link), a new one, or after a reset link. The email rides along,
 * hidden, so the browser saves the two together.
 */
function NewPassword({ email, reset = false, onDone }: { email: string; reset?: boolean; onDone?: () => void }) {
  const [password, setPasswordTyped] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle')
  if (state === 'saved') return <p className="account-note">{reset ? 'Password changed. You’re signed in.' : 'Password saved. Your browser can fill it in next time.'}</p>
  return (
    <form
      className="account-form"
      onSubmit={(e) => {
        e.preventDefault()
        setState('saving')
        setPassword(password)
          .then(() => {
            setState('saved')
            if (onDone) setTimeout(onDone, 1500)
          })
          .catch((error: unknown) => setState({ error: error instanceof Error ? error.message : 'Bounce couldn’t save the password. Try again.' }))
      }}
    >
      {reset && <p className="account-heading">Choose a new password for {email}</p>}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <input
        type="password"
        name="new-password"
        className="account-input"
        placeholder={`New password (${MIN_PASSWORD}+ characters)`}
        aria-label="New password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        required
        autoFocus
        value={password}
        onChange={(e) => setPasswordTyped(e.target.value)}
      />
      <button type="submit" className="account-send" disabled={state === 'saving'}>
        {state === 'saving' ? 'Saving…' : 'Save'}
      </button>
      {typeof state === 'object' && <p className="account-error">{state.error}</p>}
    </form>
  )
}

/** Whether the signed-in account has a password: one made by email link alone has none until it's set. */
function useHasPassword() {
  const email = useAccount((s) => s.email)
  const [has, setHas] = useState(false)
  useEffect(() => {
    // Supabase doesn't say whether an account has a password, so Bounce notes it on the account when one's chosen (see setPassword, signUpWithPassword).
    void supabase?.auth.getUser().then(({ data }) => setHas(data.user?.user_metadata?.has_password === true))
  }, [email])
  return has
}

type Mode = 'sign-in' | 'sign-up' | 'reset' | 'link'

/**
 * Signed out: an email and password, which the browser can save and fill
 * in, to sign in, or to make an account; a reset for a forgotten password;
 * or, with no password at all, a link by email.
 */
function SignIn({ linkError }: { linkError: string | null }) {
  const [mode, setMode] = useState<Mode>(linkError ? 'link' : 'sign-in')
  const [email, setEmail] = useState('')
  const [password, setPasswordTyped] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | { sent: string } | { error: string }>('idle')
  const go = (next: Mode) => {
    setMode(next)
    setState('idle')
  }

  if (typeof state === 'object' && 'sent' in state) {
    return (
      <div className="menu-item account-row">
        <span className="menu-item-title">Check your email</span>
        <span className="menu-item-about">{state.sent}</span>
        <button type="button" className="account-link" onClick={() => go('sign-in')}>
          Back to sign in
        </button>
      </div>
    )
  }

  const submit = async () => {
    setState('busy')
    try {
      if (mode === 'sign-in') {
        await signInWithPassword(email, password)
        return
      }
      if (mode === 'sign-up') {
        const confirming = await signUpWithPassword(email, password)
        if (confirming) setState({ sent: `Tap the link we sent to ${email.trim()} to confirm it’s yours, then you’re signed in. It can take a minute to arrive.` })
        return
      }
      if (mode === 'reset') {
        await sendPasswordReset(email)
        setState({ sent: `We sent a link to ${email.trim()} to choose a new password. It can take a minute to arrive.` })
        return
      }
      await sendSignInLink(email)
      setState({ sent: `Tap the link we sent to ${email.trim()} to sign in. It can take a minute to arrive.` })
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Bounce couldn’t reach your account. Check your connection and try again.' })
    }
  }

  const title = { 'sign-in': 'Sign in to sync your songs', 'sign-up': 'Make an account', reset: 'Reset your password', link: 'Sign in with an email link' }[mode]
  const about = {
    'sign-in': 'Keep them on all your devices.',
    'sign-up': 'Your songs sync across your devices. We’ll email you once, to confirm the address.',
    reset: 'We’ll email you a link to choose a new one.',
    link: 'No password: we email you a link to tap.',
  }[mode]
  const action = { 'sign-in': 'Sign in', 'sign-up': 'Make account', reset: 'Send link', link: 'Send link' }[mode]
  const withPassword = mode === 'sign-in' || mode === 'sign-up'

  return (
    <>
      <div className="menu-item account-row">
        <span className="menu-item-title">{title}</span>
        <span className="menu-item-about">{about}</span>
      </div>
      {/* A real form, its fields named as browsers expect, so the password is offered to be saved and is filled in next time. */}
      <form
        className="account-form account-form-stacked"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          type="email"
          name="email"
          className="account-input"
          placeholder="you@example.com"
          aria-label="Your email"
          autoComplete={withPassword ? 'username' : 'email'}
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {withPassword && (
          <input
            type="password"
            name="password"
            className="account-input"
            placeholder={mode === 'sign-up' ? `Password (${MIN_PASSWORD}+ characters)` : 'Password'}
            aria-label="Password"
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={mode === 'sign-up' ? MIN_PASSWORD : undefined}
            required
            value={password}
            onChange={(e) => setPasswordTyped(e.target.value)}
          />
        )}
        <button type="submit" className="account-send" disabled={state === 'busy'}>
          {state === 'busy' ? 'One moment…' : action}
        </button>
        {typeof state === 'object' && 'error' in state ? <p className="account-error">{state.error}</p> : mode === 'link' && linkError && <p className="account-error">{linkError}</p>}
      </form>
      <div className="account-switches">
        {mode === 'sign-in' && (
          <>
            <button type="button" className="account-link" onClick={() => go('sign-up')}>
              Make an account
            </button>
            <button type="button" className="account-link" onClick={() => go('reset')}>
              Forgot password?
            </button>
          </>
        )}
        {mode !== 'sign-in' && (
          <button type="button" className="account-link" onClick={() => go('sign-in')}>
            {mode === 'sign-up' ? 'Have an account? Sign in' : 'Sign in with a password'}
          </button>
        )}
        {mode !== 'link' && (
          <button type="button" className="account-link" onClick={() => go('link')}>
            Email me a link instead
          </button>
        )}
      </div>
    </>
  )
}
