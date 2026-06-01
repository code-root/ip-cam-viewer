import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requirePermission } from '../lib/auth-middleware.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('notifications'));

async function sendNotification(channel: { type: string; config: string }, event: string, payload: object) {
  const cfg = JSON.parse(channel.config);
  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });

  if (channel.type === 'webhook' && cfg.url) {
    await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cfg.headers },
      body,
    });
  } else if (channel.type === 'telegram' && cfg.botToken && cfg.chatId) {
    await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text: `[IPCam] ${event}\n${body}` }),
    });
  } else if (channel.type === 'email' && cfg.to) {
    console.log('[email notification]', cfg.to, body);
  }
}

export async function dispatchEvent(event: string, payload: object) {
  const channels = await prisma.notificationChannel.findMany({ where: { enabled: true } });
  for (const ch of channels) {
    const events = JSON.parse(ch.events || '[]') as string[];
    if (events.includes(event) || events.includes('*')) {
      try {
        await sendNotification(ch, event, payload);
      } catch (e) {
        console.error('[notification]', ch.name, e);
      }
    }
  }
}

router.get('/channels', async (_req, res) => {
  const channels = await prisma.notificationChannel.findMany();
  res.json({
    channels: channels.map((c) => ({ ...c, config: JSON.parse(c.config), events: JSON.parse(c.events) })),
  });
});

router.post('/channels', async (req, res) => {
  const { name, type, config, events, enabled } = req.body;
  const channel = await prisma.notificationChannel.create({
    data: {
      name,
      type,
      config: JSON.stringify(config || {}),
      events: JSON.stringify(events || ['motion']),
      enabled: enabled !== false,
    },
  });
  res.status(201).json({ channel });
});

router.patch('/channels/:id', async (req, res) => {
  const data: Record<string, unknown> = {};
  if (req.body.name) data.name = req.body.name;
  if (req.body.config) data.config = JSON.stringify(req.body.config);
  if (req.body.events) data.events = JSON.stringify(req.body.events);
  if (req.body.enabled !== undefined) data.enabled = req.body.enabled;
  const channel = await prisma.notificationChannel.update({ where: { id: req.params.id }, data });
  res.json({ channel });
});

router.delete('/channels/:id', async (req, res) => {
  await prisma.notificationChannel.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.post('/test', async (req, res) => {
  const { channelId } = req.body;
  const channel = await prisma.notificationChannel.findUnique({ where: { id: channelId } });
  if (!channel) return res.status(404).json({ error: 'Not found' });
  await sendNotification(channel, 'test', { message: 'Test notification from IP Camera Viewer' });
  res.json({ ok: true });
});

export default router;
