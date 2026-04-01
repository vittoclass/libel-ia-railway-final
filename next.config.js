/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  output: 'standalone',
  experimental: {
    serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
};

module.exports = nextConfig;
