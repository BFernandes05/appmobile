module.exports = {
  globDirectory: 'dist',
  globPatterns: ['**/*.{html,js,css,json,png,ico,ttf,wasm}'],
  swDest: 'dist/sw.js',
  navigateFallback: '/index.html',
  cleanupOutdatedCaches: true,
  // Ativa imediatamente cada nova versao publicada, mesmo com a PWA aberta.
  clientsClaim: true,
  skipWaiting: true,
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\//,
      handler: 'NetworkOnly',
    },
  ],
};
