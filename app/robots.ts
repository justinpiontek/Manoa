import type { MetadataRoute } from 'next'
import { appUrl } from '@/src/lib/env'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = appUrl()

  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
