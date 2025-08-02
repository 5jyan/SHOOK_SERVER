import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes/index";
import { serveVite } from "./vite";
import { YouTubeMonitor } from "./youtube-monitor";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Add a very early log for all POST requests
app.post('*', (req, res, next) => {
  console.log('Backend: Received ANY POST request to', req.path, 'with body:', req.body);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(`[express] ${logLine}`);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error(err);
  });

  console.log(`[express] App environment: ${app.get("env")}`);

  // Only serve Vite in production mode
  if (process.env.NODE_ENV === 'production') {
    serveVite(app);
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    console.log(`[express] serving on port ${port}`);
    
    const monitor = new YouTubeMonitor();
    monitor.startMonitoring();
    console.log(`[express] YouTube channel monitoring started`);
  });
})();