import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "../auth";
import { setupChannelRoutes } from "./channels";
import { setupSlackRoutes } from "./slack";
import { setupSummaryRoutes } from "./summary";

export function registerRoutes(app: Express): Server {
  // Authentication routes
  setupAuth(app);
  
  // Feature routes
  setupChannelRoutes(app);
  setupSlackRoutes(app);
  setupSummaryRoutes(app);

  const server = createServer(app);
  return server;
}