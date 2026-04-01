/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  output: 'standalone',
  // FIX_BUILD_PATH_REVERSIBLE: limpieza de config obsoleta para build Next.js 14 en Railway
};

module.exports = nextConfig;
