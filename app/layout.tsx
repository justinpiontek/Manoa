import type { Metadata } from 'next'
import Script from 'next/script'
import { appUrl } from '@/src/lib/env'
import { siteDescription, siteTitle } from '@/src/lib/siteMetadata'
import './globals.css'

const baseUrl = appUrl()
const googleAnalyticsId = 'G-T8WDT7SRYQ'
const analyticsEnabled = process.env.NODE_ENV === 'production'

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
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
      { url: '/favicon.ico?v=4', type: 'image/png', sizes: '64x64' },
      { url: '/brand-icon?v=4', type: 'image/png', sizes: '64x64' },
      { url: '/favicon.svg?v=4', type: 'image/svg+xml' },
    ],
    shortcut: [{ url: '/favicon.ico?v=4', sizes: '64x64' }],
    apple: [{ url: '/brand-apple-icon?v=4', type: 'image/png', sizes: '180x180' }],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        {analyticsEnabled ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${googleAnalyticsId}');
              `}
            </Script>
          </>
        ) : null}
        {children}
      </body>
    </html>
  )
}
