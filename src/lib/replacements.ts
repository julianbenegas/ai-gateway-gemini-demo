import { z } from 'zod'

export const replacementsSchema = z.array(
  z.object({
    search: z.string(),
    replace: z.string(),
    all: z.boolean().optional(),
  }),
)

export type Replacement = z.infer<typeof replacementsSchema>[number]

/** Applies literal search/replace pairs in order and counts each match. */
export function applyReplacements({
  html: source,
  replacements,
}: {
  html: string
  replacements: Replacement[]
}) {
  let html = source
  const matches = replacements.map(({ search, replace, all }) => {
    let count = 0
    if (search) {
      const replacement = () => {
        count++
        return replace
      }
      html = all
        ? html.replaceAll(search, replacement)
        : html.replace(search, replacement)
    }
    return count
  })
  return { html, matches }
}
