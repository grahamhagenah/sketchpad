import { useEffect, useState } from 'react'

const QUERY = '(max-width: 640px)'

/** Whether the screen is phone-sized, kept up to date as it turns or resizes. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setNarrow(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return narrow
}
