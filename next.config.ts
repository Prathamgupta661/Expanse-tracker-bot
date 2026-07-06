import type { NextConfig } from "next";

function getAllowedDevOrigins(): string[] {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!appBaseUrl) {
    return [];
  }

  try {
    return [new URL(appBaseUrl).host];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
};

export default nextConfig;
