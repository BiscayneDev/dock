import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Approval previews: the headless Chromium (@sparticuz/chromium) must load from node_modules unbundled,
  // and its binary files must ship with the worker tick function that captures previews.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Runtime user data and local credentials must never enter server bundles.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "./.data/**/*", "./.config/**/*", "./.env*"],
  },
  outputFileTracingIncludes: {
    "/api/worker/tick": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
