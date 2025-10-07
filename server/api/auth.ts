import { Router } from "express";
import passport from "passport";
import { storage } from "../repositories/storage.js";
import { hashPassword } from "../lib/auth.js";

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
        },
      });
    });
  } catch (error) {
    console.error("Kakao verification error:", error);
    res.status(500).json({ error: "Kakao authentication failed" });
  }
});

export default router;
