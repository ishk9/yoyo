import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // e2e builds prod into a separate dir so it doesn't clash with the running dev server
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
