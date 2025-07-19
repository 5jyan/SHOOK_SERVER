import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";

export function registerRoutes(app: Express): Server {
  // sets up /api/register, /api/login, /api/logout, /api/user
  setupAuth(app);

  // put additional application routes here
  // prefix all routes with /api

  const httpServer = createServer(app);

  return httpServer;
}
