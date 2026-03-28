import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // For webpack builds: disable parsing of `new URL()` syntax which conflicts
  // with @sparkjsdev/spark's WASM loading pattern.
  // Not needed when using Turbopack (default in `next dev`).
  webpack: (config) => {
    config.module.parser = {
      ...config.module.parser,
      javascript: {
        ...config.module.parser?.javascript,
        url: false,
      },
    };
    return config;
  },
};

export default nextConfig;
