export const LIVE_MODEL = 'google/gemini-3.8-live'
/** Reasons in the background while it keeps talking. */
export const LIVE_THINKING_MODEL = 'google/gemini-3.8-live-extended-thinking'
export const VISION_MODEL = 'google/gemini-3.8-flash'

/** `none` uses the regular model; the rest, extended thinking at that level. */
export const thinkingLevels = ['none', 'low', 'medium', 'high'] as const
export type ThinkingLevel = (typeof thinkingLevels)[number]

export const nextThinkingLevel = (level: ThinkingLevel) =>
  thinkingLevels[(thinkingLevels.indexOf(level) + 1) % thinkingLevels.length]

/**
 * Gemini Live session options. Tools don't block: the model keeps talking
 * while they run. Gateway rejects a thinking config on the regular model, and
 * without one the thinking model answers like the regular model.
 */
export const liveProviderOptions = ({
  thinking,
}: {
  thinking: ThinkingLevel
}) => ({
  google: {
    defaultToolBehavior: 'NON_BLOCKING',
    ...(thinking !== 'none' && { thinkingConfig: { thinkingLevel: thinking } }),
  },
})
