import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse reads test files at import time — keep it out of the bundle
  serverExternalPackages: ["pdf-parse"],
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["employer-starship-frivolous.ngrok-free.app"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "profile.line-scdn.net",
      },
    ],
  },
};

export default nextConfig;
