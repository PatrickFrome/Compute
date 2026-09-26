import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // R88-RESILIENCE: Next 16 expects hostname patterns WITHOUT protocol —
  // protocol-prefixed entries silently never match, blocking /_next/* for
  // the preview origin (observed live: "Blocked cross-origin request from
  // preview-chat-*.space-z.ai" despite the config being present).
  allowedDevOrigins: ["*.space-z.ai", "space-z.ai", "127.0.0.1", "localhost"],
};

export default nextConfig;
