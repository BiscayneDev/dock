import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip lint/typecheck during Vercel builds to reduce memory usage
  // We validate these locally before pushing
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // pdfkit loads its built-in fonts through package "imports"
  // (#standard-fonts/*), which file tracing misses; ship them explicitly
  // for every server route that can render a PDF.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/pdfkit/js/standard-fonts/**/*"],
  },
};

export default nextConfig;
