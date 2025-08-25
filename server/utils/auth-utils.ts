import type { Request, Response, NextFunction } from "express";
import { logWithTimestamp, errorWithTimestamp } from "./timestamp.js";

// Middleware to check if user is authenticated
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Middleware to check if user is accessing their own resources
export function authorizeUser(req: Request, res: Response, next: NextFunction) {
  const requestedUserId = parseInt(req.params.userId, 10);
  if (!req.user || requestedUserId !== req.user.id) {
    logWithTimestamp(`[AUTH] Access denied - user ${req.user?.id} tried to access user ${requestedUserId}'s resources`);
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}