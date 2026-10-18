import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const port = process.env.AUTOMATION_API_PORT ?? "43124";
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
