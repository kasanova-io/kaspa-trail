// ABOUTME: Next.js config with API proxy to forensics backend.
// ABOUTME: Rewrites /api/* requests to the FastAPI server (configurable via BACKEND_URL).

import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://localhost:8010";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
