import { Router } from "express";
import passport from "passport";
import { storage } from "../repositories/storage.js";
import { hashPassword } from "../lib/auth.js";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

// Helper function to compare passwords using scrypt
async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

const router = Router();

router.post("/register", async (req, res, next) => {
  const existingUser = await storage.getUserByUsername(req.body.username);
  if (existingUser) {
    return res.status(400).send("Username already exists");
  }

  const user = await storage.createUser({
    ...req.body,
    password: await hashPassword(req.body.password),
  });

  req.login(user, (err) => {
    if (err) return next(err);
    res.status(201).json(user);
  });
});

router.post("/login", passport.authenticate("local"), (req, res) => {
  res.status(200).json(req.user);
});

router.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.sendStatus(200);
  });
});

router.get("/user", (req, res) => {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  res.json(req.user);
});

// ID/Password authentication endpoint (for App Store review)
router.post("/auth/email/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    // Find user by username
    const user = await storage.getUserByUsername(username);

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Verify password (using scrypt)
    const isValidPassword = await comparePasswords(password, user.password || '');

    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Create session
    req.login(user, (err) => {
      if (err) return next(err);
      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
        },
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Account deletion endpoint
router.delete("/auth/account", async (req, res, next) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const userId = (req.user as any).id;

    // Delete user account and all associated data
    // This will cascade delete user_channels and push_tokens due to foreign key constraints
    await storage.deleteUser(userId);

    // Destroy session after account deletion
    req.logout((err) => {
      if (err) {
        console.error("Error logging out after account deletion:", err);
        // Continue anyway since account is deleted
      }
      res.status(200).json({ success: true, message: "Account deleted successfully" });
    });
  } catch (error) {
    console.error("Account deletion error:", error);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// Kakao authentication endpoint
router.post("/auth/kakao/verify", async (req, res, next) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "Access token is required" });
    }

    // Verify Kakao token and get user info from Kakao API
    const kakaoResponse = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
    });

    if (!kakaoResponse.ok) {
      return res.status(401).json({ error: "Invalid Kakao token" });
    }

    const kakaoUser = await kakaoResponse.json();
    const kakaoId = kakaoUser.id.toString();
    const email = kakaoUser.kakao_account?.email || null;
    const nickname = kakaoUser.properties?.nickname || "카카오 사용자";

    // Find or create user in our database
    let user = await storage.getUserByKakaoId(kakaoId);

    if (!user) {
      // Create new user with Kakao info
      user = await storage.createUser({
        username: `kakao_${kakaoId}`, // Unique username
        email: email,
        kakaoId: kakaoId,
        authProvider: "kakao",
        role: "user",
      });
    }

    // Create session
    req.login(user, (err) => {
      if (err) return next(err);
      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          name: nickname,
          username: user.username,
          role: user.role, // Include role for channel limit logic
        },
      });
    });
  } catch (error) {
    console.error("Kakao verification error:", error);
    res.status(500).json({ error: "Kakao authentication failed" });
  }
});

export default router;
