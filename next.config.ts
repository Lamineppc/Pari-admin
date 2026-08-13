import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      { source: '/privacy', destination: '/privacy/index.html' },
    ];
  },
};

export default nextConfig;
