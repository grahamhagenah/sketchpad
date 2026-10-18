import { useState } from 'react'
import { sendSignInLink, signOut, supabase, useAccount } from '../cloud'

/**
 * The account, in the sketches menu: signed out, a way to sign in by email
 * (a link to tap, no password); signed in, who as, and signing out.
 */
export function AccountSection() {
  const { email, ready } = useAccount()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | { error: string }>('idle')
  if (!supabase || !ready) return null

  if (email) {
    return (
      <div className="menu-item account-row">
        <span className="menu-item-title">Signed in</span>
        <span className="menu-item-about account-email">{email}</span>
        <button type="button" className="account-link" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    )
  }

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
      <button type="button" className="menu-item has-icon deleted-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="menu-item-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
          </svg>
        </span>
        <span className="menu-item-title">Sign in</span>
        <span className="menu-item-about">With your email: no password, just a link to tap</span>
      </button>
      {open && (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!typed.trim()) return
            setState('sending')
            sendSignInLink(typed)
              .then(() => setState('sent'))
              .catch((error: unknown) => setState({ error: error instanceof Error ? error.message : 'Bounce couldn’t send the link. Try again in a moment.' }))
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
          {typeof state === 'object' && <p className="account-error">{state.error}</p>}
        </form>
      )}
    </>
  )
}
