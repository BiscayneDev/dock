import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip lint/typecheck during Vercel builds to reduce memory usage
  // We validate these locally before pushing
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // pdfkit loads its built-in fonts through package "imports"
  // (#standard-fonts/*), which file tracing misses; ship them explicitly
  // for every server route that can render a PDF.
  // The old Telegram-era onboarding is retired from the public site: every
  // link that still points there (connect-flow errors, old bookmarks) lands
  // on the Dinghy sign-in instead. The page stays in the repo.
  async redirects() {
    return [{ source: '/onboarding', destination: '/login', permanent: false }]
  },
  webpack: (config) => {
    // Import the browser-use bootstrap script as a string asset (?raw).
    config.module.rules.push({ test: /\.py$/, resourceQuery: /raw/, type: 'asset/source' })
    return config
  },
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
  },
};

export default nextConfig;
