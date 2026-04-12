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
    icon: '/favicon.svg?v=2',
    shortcut: '/favicon.svg?v=2',
    apple: '/favicon.svg?v=2',
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
