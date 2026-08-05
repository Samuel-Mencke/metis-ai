import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@cursor/sdk"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
