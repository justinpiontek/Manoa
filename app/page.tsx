import type { Metadata } from 'next'
import ManoaSignupPage from '@/src/components/ManoaSignupPage'
import { appUrl } from '@/src/lib/env'

const baseUrl = appUrl()

export const metadata: Metadata = {
  title: 'Manoa | Text to schedule anything',
  description:
    'Manoa is a calendar assistant you text. Book meetings, get reminders, and manage your calendar by text.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Manoa | Text to schedule anything',
    description:
      'Manoa is a calendar assistant you text. Book meetings, get reminders, and manage your calendar by text.',
    url: baseUrl,
    siteName: 'Manoa',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Manoa | Text to schedule anything',
    description:
      'Manoa is a calendar assistant you text. Book meetings, get reminders, and manage your calendar by text.',
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
