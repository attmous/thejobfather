import type { NextConfig } from "next";
import { resolve } from "node:path";

const backend = process.env.JOBFATHER_API_URL ?? "http://127.0.0.1:8000";

const config: NextConfig = {
  turbopack: { root: resolve(process.cwd(), "..") },
  devIndicators: false,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: backend + "/api/:path*" }];
  },
};

export default config;
