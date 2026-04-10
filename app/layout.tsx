import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Manoa | Text to schedule anything',
  description:
    'Manoa is a calendar assistant you text. Send a request, get the best times, reply with a number, and it books the event.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
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
