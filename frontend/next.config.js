/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true }, // no Next image server available in a static Electron build
  trailingSlash: true,
};

module.exports = nextConfig;
