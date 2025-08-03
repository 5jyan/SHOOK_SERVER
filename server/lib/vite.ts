import express from 'express';
import path from 'path';
import fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serveVite = (app: express.Application) => {
  if (process.env.NODE_ENV === 'development') {
    // In development, proxy requests to the Vite dev server
    console.log('[express] Development mode: Proxying to Vite server at http://localhost:5173');
    app.use(
      '/',
      createProxyMiddleware({
        target: 'http://localhost:5173',
        changeOrigin: true,
        ws: true, // proxy websockets
        logLevel: 'debug',
      })
    );
  } else {
    // In production, serve static files from the build directory
    const clientBuildPath = path.resolve(__dirname, '..', 'public');
    console.log(`[express] Production mode: Serving static files from ${clientBuildPath}`);

    if (!fs.existsSync(clientBuildPath)) {
      console.error(`[express] Error: Build directory not found at ${clientBuildPath}`);
      process.exit(1);
    }

    app.use(express.static(clientBuildPath));

    // For any other request, serve the index.html
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientBuildPath, 'index.html'));
    });
  }
};