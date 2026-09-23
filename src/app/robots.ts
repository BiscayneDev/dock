import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/profile', '/dashboard', '/admin', '/harbor', '/onboarding', '/connect', '/auth/'],
      },
    ],
    sitemap: 'https://www.getdinghy.sh/sitemap.xml',
    host: 'https://www.getdinghy.sh',
  }
}
