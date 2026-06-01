import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { v4 as uuid } from 'uuid';

const router = Router();

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  totpCode: z.string().optional(),
});

function signTokens(user: { id: string; username: string; role: string }) {
  const access = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
  const refreshToken = uuid();
  return { access, refreshToken };
}

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { username, password, totpCode } = parsed.data;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.totpEnabled && user.totpSecret) {
    if (!totpCode) return res.status(401).json({ error: '2FA required', requires2FA: true });
    const valid = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: 1,
    });
    if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });
  }

  const { access, refreshToken } = signTokens(user);
  await prisma.session.create({
    data: {
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  res.json({
    accessToken: access,
    refreshToken,
    user: { id: user.id, username: user.username, role: user.role, totpEnabled: user.totpEnabled },
    idleTimeoutMinutes: config.idleTimeoutMinutes,
  });
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  const session = await prisma.session.findUnique({ where: { refreshToken }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const { access, refreshToken: newRefresh } = signTokens(session.user);
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshToken: newRefresh, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });

  res.json({ accessToken: access, refreshToken: newRefresh });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, username: true, role: true, totpEnabled: true },
  });
  res.json({ user, idleTimeoutMinutes: config.idleTimeoutMinutes });
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const secret = speakeasy.generateSecret({ name: `IPCam (${req.user!.username})` });
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { totpSecret: secret.base32 },
  });

  const qr = await QRCode.toDataURL(secret.otpauth_url || '');
  res.json({ secret: secret.base32, qrCode: qr });
});

router.post('/2fa/verify', requireAuth, async (req, res) => {
  const { code } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user?.totpSecret) return res.status(400).json({ error: 'Setup 2FA first' });

  const valid = speakeasy.totp.verify({
    secret: user.totpSecret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (!valid) return res.status(400).json({ error: 'Invalid code' });

  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: true },
  });
  res.json({ enabled: true });
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  res.json({ enabled: false });
});

export default router;
