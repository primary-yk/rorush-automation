import type { NextConfig } from "next";
import { licenseDevSkipEnabled, readEnvFileValue } from "./lib/env-path.ts";

const apiPort = readEnvFileValue("AUTOMATION_API_PORT") ?? process.env.AUTOMATION_API_PORT ?? "43124";
const apiHost = readEnvFileValue("AUTOMATION_API_HOST") ?? process.env.AUTOMATION_API_HOST ?? "127.0.0.1";
const devSkip = licenseDevSkipEnabled();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_AUTOMATION_API_URL:
      process.env.NEXT_PUBLIC_AUTOMATION_API_URL ?? `http://${apiHost}:${apiPort}`,
    RUSH_PILOT_DEV_SKIP: devSkip ? "true" : "false",
    NEXT_PUBLIC_RUSH_PILOT_DEV_SKIP: devSkip ? "true" : "false",
  },
  async rewrites() {
    const port = apiPort;
    return [
      {
        source: "/api/:path((?!license(?:/|$)).*)",
        destination: `http://127.0.0.1:${port}/api/:path*`,
      },
      {
        source: "/health",
        destination: `http://127.0.0.1:${port}/health`,
      },
    ];
  },
};

export default nextConfig;
