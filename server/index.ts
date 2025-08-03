import 'dotenv/config';
import { createServer } from "http";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import { storage } from "./repositories/storage.js";
import { setupPassport } from "./lib/auth.js";
import apiRouter from "./api/index.js";
import { serveVite } from "./lib/vite.js";
import { youtubeMonitor } from "./services/index.js";

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
  app.use("/api", apiRouter);

  // Create the server after setting up routes
  const server = createServer(app);

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
    
    youtubeMonitor.startMonitoring();
    console.log(`[express] YouTube channel monitoring started`);
  });
})();
