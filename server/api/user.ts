import { Router } from "express";
import { isAuthenticated } from "../utils/auth-utils.js";

const router = Router();

// GET /api/user - Get current authenticated user
router.get("/", isAuthenticated, (req, res) => {
  console.log(`[USER] Getting user info for ${req.user!.username}`);
  res.json(req.user);
});

export default router;