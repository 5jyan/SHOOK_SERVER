import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "../auth";
import { setupChannelRoutes } from "./channels";
import { setupSlackRoutes } from "./slack";
import { setupSummaryRoutes } from "./summary";
import googleAuthRoutes from "./google";

export function registerRoutes(app: Express): Server {
  // Authentication routes
  setupAuth(app);
  app.use("/api/auth/google", googleAuthRoutes);
  
  // Feature routes
  setupChannelRoutes(app);
  setupSlackRoutes(app);
  setupSummaryRoutes(app);

  const server = createServer(app);
  return server;
}