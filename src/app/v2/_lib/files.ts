import { z } from 'zod'

/** A design is a static site: text files by path, pages ending in .html. */
export type SiteFiles = Record<string, string>

export const HOME = 'index.html'

export const filePath = z
  .string()
  .max(120)
  .regex(
    /^(?:[\w-]+\/)*[\w-][\w.-]*\.(?:html|css|js|mjs|json|svg|txt|xml|webmanifest)$/,
    'Use a relative path like about.html, styles.css, or blog/index.html.',
  )

/**
 * The URL a page is served at, as the preview server resolves it:
 * index.html is /, about.html is /about, and blog/index.html is /blog/.
 */
export const pageUrl = (file: string) =>
  `/${file.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`
