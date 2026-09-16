import type { Metadata } from 'next'
import 'tldraw/tldraw.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Margin — a little room for ideas',
  description:
    'A canvas for building websites together. Talk, sketch, and explore with a live design partner.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
