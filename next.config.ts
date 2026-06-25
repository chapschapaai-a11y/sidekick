import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  transpilePackages: ["playwright-core"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const playwrightPath = resolve("node_modules/playwright-core");
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...config.resolve.alias,
        "playwright-core": playwrightPath,
      };
    }
    return config;
  },
};

export default nextConfig;
