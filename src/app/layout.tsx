import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import 'tldraw/tldraw.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Margin — Voice canvas',
  description:
    'A canvas for building websites together. Talk, sketch, and explore with a live design partner.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
