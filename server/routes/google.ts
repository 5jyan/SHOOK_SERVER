import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db';
import { users, User } from '../../shared/schema'; // User 타입 임포트
import { eq } from 'drizzle-orm';

const router = Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 1. Google 토큰 검증 및 payload 반환 함수
async function verifyGoogleToken(token: string) {
  console.log('Backend: Verifying Google token...');
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Invalid token payload.');
  }
  console.log('Backend: Token verification successful. Payload:', payload.email);
  return payload;
}

// 2. 사용자 조회 또는 생성 함수
async function findOrCreateUser(googleId: string, email: string, username: string): Promise<User> {
  console.log('Backend: Searching for user with email:', email);
  let [user] = await db.select().from(users).where(eq(users.email, email)).execute();

  if (!user) {
  console.log('Backend: User not found, creating new user.');
    const [newUser] = await db.insert(users).values({
      googleId,
      email,
      username,
      authProvider: 'google',
    }).returning().execute();
    user = newUser;
} else {
    console.log('Backend: User found:', user.username);
  }
  return user;
}

// 3. 세션 로그인 처리 함수
function handleSessionLogin(req: Request, res: Response, user: User) {
  return new Promise<void>((resolve, reject) => {
    req.login(user, (err) => {
      if (err) {
        console.error('Backend: Session login error:', err);
        return reject(new Error('Session login error'));
      }
      console.log('Backend: User logged in successfully. Sending user data:', user.username);
      res.json({ user });
      resolve();
    });
  });
}

router.post('/verify', async (req, res) => {
  const { token } = req.body;
  console.log('Backend: Received request to /api/auth/google/verify');
  console.log('Backend: Received token (first 20 chars):', token ? token.substring(0, 20) + '...' : 'No token');

  try {
    const payload = await verifyGoogleToken(token);
    const { sub: googleId, email, name: username } = payload;

    const user = await findOrCreateUser(googleId, email, username);

    await handleSessionLogin(req, res, user);

  } catch (error) {
    console.error('Backend: Google verification or login error:', error);
    if (error instanceof Error) {
      res.status(400).json({ message: error.message }); // 클라이언트에게 더 구체적인 오류 메시지 전달
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
});

export default router;