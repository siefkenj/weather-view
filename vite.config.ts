import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relocatable build: `vite build` emits relative asset URLs ("./assets/…") so
// dist/ runs from any location (domain root, a "/weather-view/" subpath, a
// custom domain, file://). The dev/preview server keeps an absolute base ("/")
// — Vite's server expects that — and binds all interfaces (host: true) so the
// port forwarded out of this dev container is reachable from the host browser.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  server: { host: true },
  preview: { host: true },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ["echarts", "echarts/core", "echarts/charts", "echarts/components", "echarts/renderers"],
          react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
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
