import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Manoa | Text to schedule anything',
  description:
    'Manoa is a calendar assistant you text. Send a request, get the best times, reply with a number, and it books the event.',
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
