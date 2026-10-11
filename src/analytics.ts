declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string; title?: string; event?: boolean }) => void }
  }
}

/**
 * Counts something done in the app as an event in GoatCounter, which uses no
 * cookies and keeps nothing personal: "export/stems", say. Under this site's
 * address, as its visits are, since the counter is shared with other sites.
 * Nothing happens when it isn't loaded: locally, or with it blocked.
 */
export function tally(event: string, title = event) {
  window.goatcounter?.count?.({ path: `${location.host}/${event}`, title, event: true })
}
