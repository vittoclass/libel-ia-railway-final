/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  output: 'standalone',
};

module.exports = nextConfig;
