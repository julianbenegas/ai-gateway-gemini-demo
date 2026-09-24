import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

export const metadata: Metadata = { title: 'Margin' }

export const viewport: Viewport = { colorScheme: 'dark' }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={GeistMono.variable}>
      <head>
        {/* The app is dark already. Dark-mode extensions like Dark Reader
            repaint backgrounds, which erases tldraw's icons: they're masked
            background colors. */}
        <meta name="darkreader-lock" />
      </head>
      <body>{children}</body>
    </html>
  )
}
