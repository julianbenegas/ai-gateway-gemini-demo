export const LIVE_MODEL = 'google/gemini-3.8-live'
/** Reasons in the background while it keeps talking. */
export const LIVE_THINKING_MODEL = 'google/gemini-3.8-live-extended-thinking'
export const VISION_MODEL = 'google/gemini-3.8-flash'

/**
 * Session options for extended thinking. Without a thinking config the model
 * answers like the regular one; Gateway rejects the config on that model.
 */
export const thinkingSessionOptions = {
  providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
}
