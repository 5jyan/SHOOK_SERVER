import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  envDir: path.resolve(import.meta.dirname), // .env 파일이 있는 프로젝트 루트 디렉토리를 명시적으로 지정
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying (sometimes helps with general proxy issues)
        secure: false, // Ignore self-signed SSL certificates (useful for localhost)
        logLevel: 'debug', // Enable verbose proxy logging
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('Vite Proxy: Forwarding request to backend:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('Vite Proxy: Received response from backend for:', req.method, req.url, 'Status:', proxyRes.statusCode);
          });
          proxy.on('error', (err, req, res) => {
            console.error('Vite Proxy: Error during proxying:', err);
          });
        },
      },
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    },
  },
});
