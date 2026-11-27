import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/referral",
        destination: "/referral.html",
      },
      {
        source: "/refer",
        destination: "/referral.html",
      },
    ];
  },
};

export default nextConfig;
