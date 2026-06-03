import path from 'path';
import type { Express } from 'express';
import express from 'express';
import { config } from '../config.js';

export function mountEdgeClient(app: Express): void {
  const dist = config.clientDist;
  app.use(express.static(dist, { index: false }));
  app.get('*', (req, res, next) => {
    const p = req.path;
    if (
      p.startsWith('/api') ||
      p.startsWith('/socket.io') ||
      p.startsWith('/go2rtc') ||
      p.startsWith('/uploads')
    ) {
      return next();
    }
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}
