/** @type {import('next').NextConfig} */
const nextConfig = {
  // Gzip-compress server responses (HTML/JSON/etc). Next.js already minifies
  // and tree-shakes client JS via SWC by default; `swcMinify` was removed as
  // a config option in Next 15 because SWC minification is now always on.
  compress: true,
};

module.exports = nextConfig;
