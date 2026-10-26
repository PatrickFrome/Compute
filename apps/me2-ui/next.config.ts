import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: __dirname },
  // Keep builds local: Next's default agent upgrade assessment sends dependency
  // metadata to npm independently of telemetry. Explicit audits remain separate.
  // Installed UI resources are immutable. Keep incremental/image cache writes
  // off disk; prerender seeds remain readable and runtime state is process-local.
  experimental: { agentUpgrade: false, isrFlushToDisk: false },
  cacheMaxMemorySize: 50 * 1024 * 1024,
  /* config options here */
  reactStrictMode: false,
};

export default nextConfig;
