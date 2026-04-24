import type { Metadata } from 'next'
import ManoaSignupPage from '@/src/components/ManoaSignupPage'
import { appUrl } from '@/src/lib/env'
import { siteDescription, siteTitle } from '@/src/lib/siteMetadata'

const baseUrl = appUrl()

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: baseUrl,
    siteName: 'Manoa',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
  },
  icons: {
    icon: [
      { url: '/favicon.ico?v=5', type: 'image/png', sizes: '64x64' },
      { url: '/brand-icon?v=5', type: 'image/png', sizes: '64x64' },
      { url: '/favicon.svg?v=5', type: 'image/svg+xml' },
    ],
    shortcut: [{ url: '/favicon.ico?v=5', sizes: '64x64' }],
    apple: [{ url: '/brand-apple-icon?v=5', type: 'image/png', sizes: '180x180' }],
  },
}

export default function Page() {
  return <ManoaSignupPage />
}
