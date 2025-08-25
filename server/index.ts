import 'dotenv/config';
import { createServer } from "http";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import { storage } from "./repositories/storage.js";
import { setupPassport } from "./lib/auth.js";
import apiRouter from "./api/index.js";
import { youtubeMonitor } from "./services/index.js";
import { logWithTimestamp, errorWithTimestamp } from "./utils/timestamp.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session and Passport middleware
const sessionSettings: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'your-secret-key-here-make-it-random-and-secure-for-production',
  resave: false,
  saveUninitialized: false,
  store: storage.sessionStore,
};
app.set("trust proxy", 1);
app.use(session(sessionSettings));
app.use(passport.initialize());
app.use(passport.session());

setupPassport();

// Add logging for ALL requests
app.use('*', (req, res, next) => {
  logWithTimestamp(`Backend: ${req.method} ${req.originalUrl} - Headers:`, JSON.stringify(req.headers, null, 2));
  if (req.method === 'POST') {
    logWithTimestamp('Backend: POST Body:', JSON.stringify(req.body, null, 2));
  }
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

      logWithTimestamp(`[express] ${logLine}`);
    }
  });

  next();
});

(async () => {
  app.use("/api", apiRouter);

  // Create the server after setting up routes
  const server = createServer(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    errorWithTimestamp("Express error:", err);
  });

  logWithTimestamp(`[express] App environment: ${app.get("env")}`);


  const port = parseInt(process.env.PORT || '3000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    logWithTimestamp(`[express] serving on port ${port}`);
    
    youtubeMonitor.startMonitoring();
    logWithTimestamp(`[express] YouTube channel monitoring started`);
  });
})();
