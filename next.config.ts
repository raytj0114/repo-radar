import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // GitHubアバターのみ許可（next/image経由の外部画像）
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
};

export default nextConfig;
