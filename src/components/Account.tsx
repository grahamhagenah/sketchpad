import { useCallback, useRef, useState } from 'react'
import { sendSignInLink, signOut, supabase, useAccount } from '../cloud'
import { syncSoon, useSync } from '../sync'
import { useDismiss } from '../hooks/useDismiss'
import { useDropBelow } from '../hooks/useDropBelow'

/**
 * The account, by the file button: signed out, signing in by email (a link
 * to tap, no password); signed in, who as, and signing out. Lit up in the
 * accent colour while signed in.
 */
export function AccountButton() {
  const { email, ready, linkError } = useAccount()
  // Open already when a sign-in link came back refused, to say why.
  const [open, setOpen] = useState(() => !!useAccount.getState().linkError)
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
          {email ? <SignedIn email={email} /> : <SignIn linkError={linkError} />}
        </div>
      )}
    </div>
  )
}

function SignedIn({ email }: { email: string }) {
  const sync = useSync()
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
      <button type="button" className="account-link" onClick={() => void signOut()} title="Your songs stay on this device too">
        Sign out
      </button>
    </div>
  )
}

function SignIn({ linkError }: { linkError: string | null }) {
  const [typed, setTyped] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | { error: string }>('idle')

  if (state === 'sent') {
    return (
      <div className="menu-item account-row">
        <span className="menu-item-title">Check your email</span>
        <span className="menu-item-about">Tap the link we sent to {typed.trim()} to sign in. It can take a minute to arrive.</span>
        <button type="button" className="account-link" onClick={() => setState('idle')}>
          Use another email
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="menu-item account-row">
        <span className="menu-item-title">Sign in to sync your songs</span>
        <span className="menu-item-about">Keep them on all your devices. No password: we email you a link.</span>
      </div>
      <form
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!typed.trim()) return
          setState('sending')
          sendSignInLink(typed)
            .then(() => setState('sent'))
            .catch((error: unknown) => setState({ error: error instanceof Error ? error.message : 'Bounce couldn’t send the link. Check your connection and try again.' }))
        }}
      >
        <input
          type="email"
          className="account-input"
          placeholder="you@example.com"
          aria-label="Your email"
          autoComplete="email"
          required
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="account-send" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send link'}
        </button>
        {typeof state === 'object' ? <p className="account-error">{state.error}</p> : linkError && <p className="account-error">{linkError}</p>}
      </form>
    </>
  )
}
