/** Shared by server pages (initial width from a cookie) and the resizer. */
export const SIDEBAR_MIN = 160
export const SIDEBAR_MAX = 480
export const SIDEBAR_DEFAULT = 216

export const clampSidebar = (width: number) =>
  Number.isFinite(width) && width > 0
    ? Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)))
    : SIDEBAR_DEFAULT

export const sidebarCookie = {
  v1: 'margin_v1_sidebar',
  v2: 'margin_v2_sidebar',
} as const
