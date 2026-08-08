import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Relocatable build: `vite build` emits relative asset URLs ("./assets/…") so
// dist/ runs from any location (domain root, a "/weather-view/" subpath, a
// custom domain, file://). The dev/preview server keeps an absolute base ("/")
// — Vite's server expects that — and binds all interfaces (host: true) so the
// port forwarded out of this dev container is reachable from the host browser.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [
    react(),
    // Service worker — build only. Precaches the app shell (hashed JS/CSS/HTML,
    // including the large ECharts chunk) so repeat visits load from cache and the
    // app opens offline. It caches *code*; the JSON weather data keeps its own
    // localStorage cache (api/httpCache.ts), so we deliberately add NO runtime API
    // caching here — layering a second cache over it would only fight its hourly
    // freshness logic. Gated to `command === "build"` so it never activates under
    // `vite dev` or the Vitest runner. All manifest URLs are relative (".") to keep
    // the installed PWA as relocatable as the rest of the build.
    ...(command === "build"
      ? [
          VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            includeAssets: ["icon.svg"],
            manifest: {
              name: "Weather View",
              short_name: "Weather View",
              description: "At-a-glance weather dashboard powered by Open-Meteo.",
              theme_color: "#0b1220",
              background_color: "#0b1220",
              display: "standalone",
              start_url: ".",
              scope: ".",
              icons: [
                { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
                { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
              ],
            },
            workbox: {
              globPatterns: ["**/*.{js,css,html,svg,woff2}"],
              // The app uses hash routing, so there is only ever one real document —
              // fall back to it for any navigation request.
              navigateFallback: "index.html",
              cleanupOutdatedCaches: true,
            },
          }),
        ]
      : []),
  ],
  server: { host: true },
  preview: { host: true },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ["echarts", "echarts/core", "echarts/charts", "echarts/components", "echarts/renderers"],
          react: ["react", "react-dom", "react-router-dom", "react-redux", "@reduxjs/toolkit"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: false,
  },
}));
