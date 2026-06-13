import type { NextConfig } from "next";

// Backend origin. The Next dev server proxies /api/* so the httpOnly session
// cookie stays first-party. WebSockets connect directly to the backend
// (ws://localhost:8000) — see lib/ws.ts.
const BACKEND = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // Self-contained server bundle for a slim production Docker image.
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
};

export default nextConfig;
