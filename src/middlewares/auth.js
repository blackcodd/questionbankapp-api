import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import nodemailer from 'nodemailer';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};



export function createAuthRouter({ db, jwtSecret }) {
  const router = express.Router();
  const limit = (n) => rateLimit({ windowMs: 15 * 60 * 1000, limit: n });

  const hashCode = (email, code) =>
    crypto.createHmac('sha256', jwtSecret).update(`${email}:${code}`).digest('hex');
  const signToken = (u) => jwt.sign({ sub: u.id, role: u.role }, jwtSecret, { expiresIn: '8h' });

  const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password
  },
});
  // returns false when asked again within 60 seconds
async function sendCode(email) {
  const recent = await db.query(
    `SELECT 1 FROM email_otps WHERE email=$1 AND created_at > now() - interval '60 seconds'`,
    [email]
  );
  if (recent.rowCount) return false;

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query(
    `INSERT INTO email_otps (email, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')`,
    [email, hashCode(email, code)]
  );

  // Send real email via SMTP
  try {
    await transporter.sendMail({
      from: `"প্রশ্ন ব্যাংক" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'আপনার অ্যাকাউন্ট ভেরিফিকেশন কোড (OTP) - প্রশ্ন ব্যাংক',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #047857; text-align: center;">প্রশ্ন ব্যাংক</h2>
          <p style="color: #334155;">আপনার অ্যাকাউন্ট ভেরিফিকেশন OTP কোডটি নিচে দেওয়া হলো:</p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #047857; background: #ecfdf5; padding: 10px 20px; border-radius: 8px;">
              ${code}
            </span>
          </div>
          <p style="color: #64748b; font-size: 13px; text-align: center;">মেয়াদ ১০ মিনিট। কারো সাথে শেয়ার করবেন না।</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('Email send failed:', err.message);
    return false;
  }
}

  router.post('/register', limit(20), wrap(async (req, res) => {
    const p = z.object({
      name: z.string().trim().min(2).max(60),
      email: z.string().email().max(200),
      password: z.string().min(8).max(72),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Check your name, email and password (8+ characters)' });

    const email = p.data.email.toLowerCase();
    const found = await db.query('SELECT email_verified FROM users WHERE email=$1', [email]);
    if (found.rows[0]?.email_verified) {
      return res.status(409).json({ error: 'This email is already registered. Please log in.' });
    }

    const hash = await bcrypt.hash(p.data.password, 12);
    await db.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET name=$1, password_hash=$3`, [p.data.name, email, hash]);

    if (!(await sendCode(email))) {
      return res.status(429).json({ error: 'Please wait a minute before asking for another code' });
    }
    res.status(201).json({ ok: true });
  }));

  router.post('/resend-code', limit(10), wrap(async (req, res) => {
    const p = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Enter a valid email' });
    const email = p.data.email.toLowerCase();

    const u = await db.query('SELECT email_verified FROM users WHERE email=$1', [email]);
    if (u.rows[0] && !u.rows[0].email_verified) {
      if (!(await sendCode(email))) {
        return res.status(429).json({ error: 'Please wait a minute before asking for another code' });
      }
    }
    res.json({ ok: true });   // same answer either way, so emails cannot be probed
  }));

  router.post('/verify-email', limit(40), wrap(async (req, res) => {
    const p = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Enter the 6-digit code' });
    const email = p.data.email.toLowerCase();

    const { rows } = await db.query(
      `SELECT id, code_hash, attempts FROM email_otps
       WHERE email=$1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`, [email]);
    const otp = rows[0];
    if (!otp || otp.attempts >= 5) {
      return res.status(400).json({ error: 'Code expired or too many tries. Ask for a new code.' });
    }
    if (!safeEqual(hashCode(email, p.data.code), otp.code_hash)) {
      await db.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id=$1', [otp.id]);
      return res.status(400).json({ error: 'Wrong code' });
    }

    const used = await db.query(
      'UPDATE email_otps SET consumed_at = now() WHERE id=$1 AND consumed_at IS NULL RETURNING id', [otp.id]);
    if (!used.rowCount) return res.status(400).json({ error: 'Code already used' });

    const { rows: [user] } = await db.query(
      'UPDATE users SET email_verified = true WHERE email=$1 RETURNING id, name, email, role', [email]);
    if (!user) return res.status(400).json({ error: 'Account not found' });
    res.json({ token: signToken(user), user });
  }));




    // a fake hash, so a missing user takes as long to check as a real one
  const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

  router.post('/login', limit(30), wrap(async (req, res) => {
    const p = z.object({
      email: z.string().email(),
      password: z.string().min(1).max(72),
    }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Enter your email and password' });
    const email = p.data.email.toLowerCase();

    const { rows: [u] } = await db.query(
      'SELECT id, name, email, role, password_hash, email_verified FROM users WHERE email=$1', [email]);

    const ok = await bcrypt.compare(p.data.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !u.password_hash || !ok) {
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    if (!u.email_verified) {
      return res.status(403).json({ error: 'Please verify your email first', needsVerification: true });
    }

    const { password_hash, email_verified, ...user } = u;
    res.json({ token: signToken(user), user });
  }));


  router.get('/me', wrap(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.split(' ')[1];

    try {
      const payload = jwt.verify(token, jwtSecret);
      const { rows: [user] } = await db.query(
        'SELECT id, name, email, role FROM users WHERE id=$1', [payload.sub]);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ ok: true, user });
    } catch (err) {
      console.error('Token verification failed:', err.message);
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  }));


  

  return router;
}