import type { Metadata } from 'next'
import { SiteStudio } from '@/components/v2/site-studio'
import './v2.css'

export const metadata: Metadata = {
  title: 'Margin — Speak your changes',
  description: 'Point at a website, talk, and change its real source.',
}

export default function Page() {
  return <SiteStudio />
}
