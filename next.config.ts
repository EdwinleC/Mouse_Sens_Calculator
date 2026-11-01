import type { NextConfig } from 'next';
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const repositoryPath = '/Mouse_Sens_Calculator';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  ...(isGitHubPages ? { basePath: repositoryPath, assetPrefix: `${repositoryPath}/` } : {}),
};
export default nextConfig;
