import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core"],
  outputFileTracingIncludes: {
    "/api/chat": ["./node_modules/playwright-core/**/*"],
    "/api/test-browser": ["./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
