import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import type { Express, Request, Response, NextFunction } from 'express';
import httpProxy from 'http-proxy';
import { config } from '../config.js';

const target = config.go2rtcApi.replace(/\/$/, '');

const proxy = httpProxy.createProxyServer({
  target,
  ws: true,
  changeOrigin: true,
});

proxy.on('error', (err) => {
  console.error('[go2rtc-proxy]', err);
});

function stripGo2rtcPrefix(url: string | undefined): string {
  if (!url) return '/';
  const path = url.startsWith('/go2rtc') ? url.slice('/go2rtc'.length) : url;
  return path || '/';
}

export function mountGo2rtcHttpProxy(app: Express): void {
  app.use('/go2rtc', (req: Request, res: Response, next: NextFunction) => {
    const origUrl = req.url;
    req.url = stripGo2rtcPrefix(origUrl);
    proxy.web(req, res, { target }, (err) => {
      req.url = origUrl;
      if (err) next(err);
    });
  });
}

export function attachGo2rtcWsProxy(httpServer: HttpServer): void {
  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!req.url?.startsWith('/go2rtc')) return;
    req.url = stripGo2rtcPrefix(req.url);
    proxy.ws(req, socket, head, { target });
  });
}
