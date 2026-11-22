import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    agentUpgrade: false,
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
  async rewrites() {
    const backendTarget = (
      process.env.BACKEND_PROXY_TARGET ?? "http://localhost:5267"
    ).replace(/\/$/, "");
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendTarget}/api/v1/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${backendTarget}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
