import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

export const metadata: Metadata = { title: 'Margin' }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={GeistMono.variable}>
      <body>{children}</body>
    </html>
  )
}
