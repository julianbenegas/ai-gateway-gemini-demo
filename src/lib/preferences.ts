/**
 * Per-browser UI preferences kept in cookies, so the server renders them and
 * nothing shifts on load. Each example uses its own names.
 */
export const preferenceCookie = {
  v1: { sidebar: 'margin_v1_sidebar', thinking: 'margin_v1_thinking' },
  v2: { sidebar: 'margin_v2_sidebar', thinking: 'margin_v2_thinking' },
} as const

/** Extended thinking is on unless the cookie turned it off. */
export const readThinking = (value: string | undefined) => value !== 'off'

/** Browser-only. */
export function writePreference({
  cookie,
  value,
}: {
  cookie: string
  value: string
}) {
  document.cookie = `${cookie}=${value}; path=/; max-age=31536000; samesite=lax`
}
