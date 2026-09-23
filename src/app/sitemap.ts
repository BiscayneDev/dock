import type { MetadataRoute } from 'next'

const SITE = 'https://www.getdinghy.sh'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/login`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
