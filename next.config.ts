import type { NextConfig } from "next";

const apiPort = process.env.AUTOMATION_API_PORT ?? "43124";
const apiHost = process.env.AUTOMATION_API_HOST ?? "127.0.0.1";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_AUTOMATION_API_URL:
      process.env.NEXT_PUBLIC_AUTOMATION_API_URL ?? `http://${apiHost}:${apiPort}`,
  },
  async rewrites() {
    const port = apiPort;
    return [
      {
        source: "/api/:path*",
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
