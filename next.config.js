/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@react-pdf/renderer'],
  output: 'standalone',
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
};

module.exports = nextConfig;
