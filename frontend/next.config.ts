import type { NextConfig } from "next";
import { resolve } from "node:path";

const backend = process.env.JOBFATHER_API_URL ?? "http://127.0.0.1:8000";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), ".."),
  turbopack: { root: resolve(process.cwd(), "..") },
  devIndicators: false,
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/app", destination: "/", permanent: false },
      { source: "/landing", destination: "/landing/index.html", permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: backend + "/api/:path*" },
    ];
  },
};

export default config;
