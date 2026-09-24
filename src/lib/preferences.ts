import { type ThinkingLevel, thinkingLevels } from './models'

/**
 * Per-browser UI preferences kept in cookies, so the server renders them and
 * nothing shifts on load. Each example uses its own names.
 */
export const preferenceCookie = {
  v1: { sidebar: 'margin_v1_sidebar', thinking: 'margin_v1_thinking' },
  v2: { sidebar: 'margin_v2_sidebar', thinking: 'margin_v2_thinking' },
  v3: { sidebar: 'margin_v3_sidebar', thinking: 'margin_v3_thinking' },
} as const

/** The saved thinking level, or the example's default. */
export const readThinkingLevel = (
  value: string | undefined,
  fallback: ThinkingLevel = 'low',
): ThinkingLevel => thinkingLevels.find((level) => level === value) ?? fallback

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
