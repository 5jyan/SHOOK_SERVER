
import { Router } from 'express';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db';
import { users } from '../../shared/schema';
import { eq } from 'drizzle-orm';

const router = Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post('/verify', async (req, res) => {
  const { token } = req.body;
  console.log('Backend: Received request to /api/auth/google/verify');
  console.log('Backend: Received token (first 20 chars):', token ? token.substring(0, 20) + '...' : 'No token');
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    console.log('Backend: Token verification successful.');
    const payload = ticket.getPayload();
    if (!payload) {
      console.error('Backend: Invalid token payload.');
      return res.status(400).json({ message: 'Invalid token' });
    }
    console.log('Backend: Token payload extracted:', payload.email, payload.name);
    const { sub: googleId, email, name: username } = payload;

    let [user] = await db.select().from(users).where(eq(users.email, email)).execute();

    if (!user) {
      console.log('Backend: User not found, creating new user.');
      // Create a new user if they don't exist
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

    req.login(user, (err) => {
      if (err) {
        console.error('Backend: Session login error:', err);
        return res.status(500).json({ message: 'Session login error' });
      }
      console.log('Backend: User logged in successfully. Sending user data:', user.username);
      return res.json({ user });
    });
  } catch (error) {
    console.error('Backend: Google verification error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
