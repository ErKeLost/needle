import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri prints its own diagnostics.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/vendor/**"] },
    // In a browser NetEase is reached through the dev server; the packaged
    // app asks Rust instead, which also holds the audio cache.
    proxy: {
      "/ne": {
        target: "https://music.163.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ne/, ""),
        headers: { Referer: "https://music.163.com/" },
      },
      "/qqs": {
        target: "https://c.y.qq.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/qqs/, ""),
        headers: { Referer: "https://y.qq.com/" },
      },
      "/qqm": {
        target: "https://u.y.qq.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/qqm/, ""),
        headers: { Referer: "https://y.qq.com/" },
      },
    },
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "oxc",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
