import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: __dirname },
  /* config options here */
  reactStrictMode: false,
};

export default nextConfig;
