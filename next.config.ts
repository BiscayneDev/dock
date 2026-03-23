import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip lint/typecheck during Vercel builds to reduce memory usage
  // We validate these locally before pushing
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
