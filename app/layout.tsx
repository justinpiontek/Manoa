import type { Metadata } from 'next'
import { appUrl } from '@/src/lib/env'
import './globals.css'

const baseUrl = appUrl()

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: 'Manoa | Text to schedule anything',
  description:
    'Manoa is a calendar assistant you text. Send a request, get the best times, reply with a number, and it books the event.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Manoa | Text to schedule anything',
    description:
      'Manoa is a calendar assistant you text. Send a request, get the best times, reply with a number, and it books the event.',
    url: baseUrl,
    siteName: 'Manoa',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Manoa | Text to schedule anything',
    description:
      'Manoa is a calendar assistant you text. Send a request, get the best times, reply with a number, and it books the event.',
  },
  icons: {
    icon: [
      { url: '/brand-icon?v=3', type: 'image/png', sizes: '64x64' },
      { url: '/favicon.svg?v=3', type: 'image/svg+xml' },
    ],
    shortcut: [{ url: '/brand-icon?v=3', type: 'image/png', sizes: '64x64' }],
    apple: [{ url: '/brand-apple-icon?v=3', type: 'image/png', sizes: '180x180' }],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
