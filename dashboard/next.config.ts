import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  turbopack: {
    root: dashboardRoot
  }
};

export default nextConfig;
