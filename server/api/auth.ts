import { Router } from "express";
import passport from "passport";
import { storage } from "../repositories/storage.js";
import { hashPassword } from "../lib/auth.js";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { errorLogger } from "../services/error-logging-service.js";

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
    return res.status(400).json({ error: "이미 사용 중인 ID입니다" });
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
      return res.status(400).json({ error: "ID와 비밀번호를 입력해주세요" });
    }

    // Find user by username
    const user = await storage.getUserByUsername(username);

    if (!user) {
      return res.status(401).json({ error: "ID 또는 비밀번호가 올바르지 않습니다" });
    }

    // Verify password (using scrypt)
    const isValidPassword = await comparePasswords(password, user.password || '');

    if (!isValidPassword) {
      return res.status(401).json({ error: "ID 또는 비밀번호가 올바르지 않습니다" });
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
    await errorLogger.logError(error as Error, {
      service: 'AuthRoutes',
      operation: 'emailLogin',
      additionalInfo: { username: req.body.username }
    });
    res.status(500).json({ error: "로그인 중 오류가 발생했습니다" });
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
    await errorLogger.logError(error as Error, {
      service: 'AuthRoutes',
      operation: 'deleteAccount',
      userId: (req.user as any)?.id
    });
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// Guest account creation endpoint
router.post("/auth/guest", async (req, res, next) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: "Device ID is required" });
    }

    // Create guest username using device ID
    const guestUsername = `guest_${deviceId}`;

    // Check if guest account already exists
    let user = await storage.getUserByUsername(guestUsername);

    if (!user) {
      // Create new guest user
      user = await storage.createUser({
        username: guestUsername,
        authProvider: "guest",
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
          username: user.username,
          role: user.role,
          isGuest: user.authProvider === 'guest',
        },
      });
    });
  } catch (error) {
    console.error("Guest account creation error:", error);
    await errorLogger.logError(error as Error, {
      service: 'AuthRoutes',
      operation: 'guestAccountCreation',
      additionalInfo: { deviceId: req.body.deviceId }
    });
    res.status(500).json({ error: "게스트 계정 생성에 실패했습니다" });
  }
});

// Kakao authentication endpoint
router.post("/auth/kakao/verify", async (req, res, next) => {
  try {
    const { accessToken, convertGuestAccount } = req.body;

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

    const shouldLinkAccount = convertGuestAccount && req.isAuthenticated();

    let user;

    if (shouldLinkAccount) {
      const currentUser = req.user as any;
      user = await storage.linkKakaoAccount(currentUser.id, kakaoId, email);
    } else {
      // Find or create user in our database for login flow
      user = await storage.getUserByKakaoId(kakaoId);

      if (!user) {
        user = await storage.createUser({
          username: `kakao_${kakaoId}`,
          email: email,
          kakaoId: kakaoId,
          authProvider: "kakao",
          role: "user",
        });
      }
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
          isGuest: user.isGuest || false,
        },
      });
    });
  } catch (error) {
    console.error("Kakao verification error:", error);
    await errorLogger.logError(error as Error, {
      service: 'AuthRoutes',
      operation: 'kakaoVerify'
    });
    res.status(500).json({ error: "Kakao authentication failed" });
  }
});

export default router;
