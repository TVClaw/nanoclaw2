import { randomUUID } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { Bonjour, type Service } from 'bonjour-service';
import WebSocket from 'ws';
import { DATA_DIR, VERBOSE } from './config.js';
import { logger } from './logger.js';
import { shouldWrapVibePage, wrapVibePageHtml } from './vibe-page-shell.js';

const VIBE_TTL_MS = 24 * 60 * 60 * 1000;
const GAMES_DIR = path.join(process.cwd(), 'games');
const STATIC_DIR = path.join(process.cwd(), 'static');

function defaultLogoPath(): string {
  const env = process.env.TVCLAW_LOGO_PATH?.trim();
  if (env && existsSync(env)) return env;
  const repoRoot = path.join(process.cwd(), '..');
  const a = path.join(repoRoot, 'TvClaw_logo.png');
  if (existsSync(a)) return a;
  return path.join(process.cwd(), 'assets', 'TvClaw_logo_small.png');
}

function defaultApkPath(): string | undefined {
  const env = process.env.TVCLAW_CLIENT_APK?.trim();
  if (env && existsSync(env)) return env;
  const p = path.join(
    process.cwd(),
    '..',
    'TVClaw',
    'apps',
    'client-android',
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk',
  );
  return existsSync(p) ? p : undefined;
}

function preferredLanIPv4(): string | null {
  let nets: ReturnType<typeof networkInterfaces>;
  try {
    nets = networkInterfaces();
  } catch {
    return null;
  }
  const v4: string[] = [];
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const e of list) {
      if (e.internal) continue;
      const fam = e.family as string | number;
      if (fam !== 'IPv4' && fam !== 4) continue;
      v4.push(e.address);
    }
  }
  const isPrivate = (ip: string) =>
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
  return v4.find(isPrivate) ?? v4[0] ?? null;
}

function normalizeHttpPath(reqUrl: string | undefined): string {
  const pathOnly = (reqUrl ?? '/').split('?')[0] ?? '/';
  let p = pathOnly.replace(/\/+/g, '/');
  if (p === '') p = '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function pickServiceHost(s: Service): string | null {
  const addrs = (s.addresses ?? []).filter(Boolean);
  const v4 = addrs.find((a) => !a.includes(':'));
  return v4 ?? addrs[0] ?? null;
}

function wsUrl(host: string, port: number): string {
  if (host.includes(':')) return `ws://[${host}]:${port}`;
  return `ws://${host}:${port}`;
}

function printLanBanner(httpPort: number, hasApk: boolean): void {
  const ip = preferredLanIPv4();
  if (!ip) {
    logger.warn(
      'Could not detect LAN IPv4; set TV host URL manually for the TV browser',
    );
    return;
  }
  const base = `http://${ip}:${httpPort}`;
  if (process.env.NO_COLOR) {
    console.log(`TVClaw on LAN — ${base}/  APK: ${base}/tvclaw-client.apk`);
    return;
  }
  const b = '\x1b[1;33m';
  const r = '\x1b[0m';
  const line = `${b}══════════════════════════════════════════════════════════════${r}`;
  console.log(`\n${line}`);
  console.log(
    `${b} TVClaw on this Mac — open on your TV browser:${r}\n` +
      `   ${b}Home${r}  ${base}/\n` +
      (hasApk ? `   ${b}APK${r}   ${base}/tvclaw-client.apk\n` : ''),
  );
  console.log(`${line}\n`);
}

export function parseTvIpcPayload(raw: unknown): {
  action: string;
  params: Record<string, unknown>;
} {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('invalid tv payload');
  }
  const o = raw as Record<string, unknown>;
  const inner = o.payload !== undefined ? o.payload : o;
  if (inner === null || typeof inner !== 'object') {
    throw new TypeError('invalid tv inner');
  }
  const p = inner as Record<string, unknown>;
  if (typeof p.action !== 'string') {
    throw new TypeError('missing action');
  }
  const params =
    p.params !== null && typeof p.params === 'object'
      ? (p.params as Record<string, unknown>)
      : {};
  return { action: p.action, params };
}

function createEnvelope(
  action: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  return {
    request_id: randomUUID(),
    timestamp: new Date().toISOString(),
    payload: { action, params },
  };
}

type TvTarget = {
  key: string;
  host: string;
  port: number;
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

export class TvBridge {
  private readonly sockets = new Set<WebSocket>();
  private httpServer: Server | null = null;
  private apkPath: string | undefined;
  private bonjour: Bonjour | null = null;
  private browser: ReturnType<Bonjour['find']> | null = null;
  private readonly targets = new Map<string, TvTarget>();
  private readonly vibeDir = path.join(DATA_DIR, 'vibes');
  private readonly sseClients = new Set<ServerResponse>();
  private readonly logoPath = defaultLogoPath();

  getHttpBaseUrl(): string {
    const ip = preferredLanIPv4() ?? '127.0.0.1';
    const port = Number(process.env.TVCLAW_HTTP_PORT ?? 8770);
    return `http://${ip}:${port}`;
  }

  addVibePage(html: string): string {
    mkdirSync(this.vibeDir, { recursive: true });
    const id = randomUUID();
    const filePath = path.join(this.vibeDir, `${id}.html`);
    const body = shouldWrapVibePage(html) ? wrapVibePageHtml(html) : html;
    writeFileSync(filePath, body, 'utf8');
    setTimeout(() => {
      try {
        unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }, VIBE_TTL_MS);
    return `${this.getHttpBaseUrl()}/vibes/${id}.html?v=${Date.now()}`;
  }

  private readVibeFile(pageId: string): string | null {
    if (
      !/^[0-9a-f-]{36}\.html$/.test(pageId) &&
      !/^[a-zA-Z0-9_-]+\.html$/.test(pageId)
    ) {
      return null;
    }
    const filePath = path.join(this.vibeDir, pageId);
    if (!existsSync(filePath)) return null;
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  sendToAll(action: string, params: Record<string, unknown>): number {
    const envelope = createEnvelope(action, params);
    const msg = JSON.stringify(envelope);
    const postBody = JSON.stringify({ action, params });
    if (VERBOSE) {
      logger.info(
        { tvPostBody: postBody, tvWebSocketJson: msg },
        'tvclaw TV command (tvPostBody matches curl -d; tvWebSocketJson is sent on WebSocket)',
      );
    }
    let n = 0;
    for (const c of this.sockets) {
      if (c.readyState === WebSocket.OPEN) {
        c.send(msg);
        n++;
      }
    }
    if (action === 'OPEN_URL') {
      const url = params.url;
      if (typeof url === 'string' && url.trim()) {
        const appId = params.app_id;
        logger.info(
          {
            action: 'OPEN_URL',
            url: url.trim(),
            tvs: n,
            ...(typeof appId === 'string' && appId.trim()
              ? { app_id: appId.trim() }
              : {}),
          },
          'tv OPEN_URL',
        );
      }
    }
    return n;
  }

  private serviceKey(s: Service): string {
    return s.fqdn ?? `${s.name}:${s.port}:${s.type}`;
  }

  private clearReconnect(t: TvTarget): void {
    if (t.reconnectTimer) {
      clearTimeout(t.reconnectTimer);
      t.reconnectTimer = null;
    }
  }

  private disposeTarget(key: string): void {
    const t = this.targets.get(key);
    if (!t) return;
    this.clearReconnect(t);
    try {
      t.ws?.removeAllListeners();
      t.ws?.close();
    } catch {
      /* ignore */
    }
    if (t.ws) this.sockets.delete(t.ws);
    t.ws = null;
    this.targets.delete(key);
  }

  private connectTarget(t: TvTarget): void {
    if (t.ws?.readyState === WebSocket.OPEN) return;
    this.clearReconnect(t);
    try {
      t.ws?.removeAllListeners();
      t.ws?.close();
    } catch {
      /* ignore */
    }
    if (t.ws) this.sockets.delete(t.ws);
    t.ws = null;
    const url = wsUrl(t.host, t.port);
    const ws = new WebSocket(url);
    t.ws = ws;
    ws.on('open', () => {
      this.sockets.add(ws);
      logger.info({ url }, 'tvclaw outbound WebSocket open');
    });
    ws.on('message', () => {
      /* TV → host messages ignored for vision-free build */
    });
    ws.on('close', () => {
      this.sockets.delete(ws);
      t.ws = null;
      if (!this.targets.has(t.key)) return;
      t.reconnectTimer = setTimeout(() => {
        t.reconnectTimer = null;
        if (this.targets.has(t.key)) this.connectTarget(t);
      }, 3000);
    });
    ws.on('error', (err) => {
      logger.debug({ err, url }, 'tvclaw outbound WebSocket error');
    });
  }

  private onServiceUp(s: Service): void {
    const host = pickServiceHost(s);
    if (host == null || !s.port) {
      logger.warn({ name: s.name }, 'tvclaw browse: missing address or port');
      return;
    }
    const key = this.serviceKey(s);
    let t = this.targets.get(key);
    if (!t) {
      t = { key, host, port: s.port, ws: null, reconnectTimer: null };
      this.targets.set(key, t);
    } else {
      const changed = t.host !== host || t.port !== s.port;
      t.host = host;
      t.port = s.port;
      if (changed) {
        this.clearReconnect(t);
        try {
          t.ws?.removeAllListeners();
          t.ws?.close();
        } catch {
          /* ignore */
        }
        if (t.ws) this.sockets.delete(t.ws);
        t.ws = null;
      }
    }
    this.connectTarget(t);
  }

  private onServiceDown(s: Service): void {
    this.disposeTarget(this.serviceKey(s));
    logger.info({ name: s.name }, 'tvclaw browse: service down');
  }

  start(): void {
    if (this.httpServer) return;
    const httpPort = Number(process.env.TVCLAW_HTTP_PORT ?? 8770);
    this.apkPath = defaultApkPath();

    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find({ type: 'tvclaw', protocol: 'tcp' });
    this.browser.on('up', (s: Service) => this.onServiceUp(s));
    this.browser.on('down', (s: Service) => this.onServiceDown(s));
    this.browser.on('error', (err: Error) => {
      logger.error({ err }, 'tvclaw bonjour browser error');
    });
    logger.info('tvclaw browsing _tvclaw._tcp (outbound WebSocket to TVs)');

    this.httpServer = createServer((req, res) => {
      const pathname = normalizeHttpPath(req.url);
      const m = req.method ?? 'GET';
      const read = m === 'GET' || m === 'HEAD';

      if (m === 'OPTIONS') {
        const allowGet =
          pathname === '/health' ||
          pathname === '/' ||
          pathname === '/tvclaw-client.apk' ||
          pathname === '/keypad' ||
          pathname === '/tvclaw-logo.png' ||
          pathname.startsWith('/games/') ||
          pathname.startsWith('/vibes/');
        if (allowGet) {
          res.writeHead(204, { Allow: 'GET, HEAD, OPTIONS' });
          res.end();
          return;
        }
        if (pathname === '/tv' || pathname === '/vibe-key') {
          res.writeHead(204, { Allow: 'POST, OPTIONS' });
          res.end();
          return;
        }
        if (pathname === '/vibe-key-sse') {
          res.writeHead(204, { Allow: 'GET, OPTIONS' });
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }

      if (read && pathname === '/health') {
        res.writeHead(200);
        if (m === 'HEAD') res.end();
        else res.end('ok');
        return;
      }

      if (read && pathname === '/') {
        if (!this.apkPath) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          if (m === 'HEAD') res.end();
          else {
            res.end(
              'TV client APK not found (build TVClaw Android app or set TVCLAW_CLIENT_APK)',
            );
          }
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (m === 'HEAD') res.end();
        else {
          res.end(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TVClaw</title></head><body>` +
              `<p><a href="/tvclaw-client.apk">Download TV client (APK)</a></p></body></html>`,
          );
        }
        return;
      }

      if (read && pathname === '/tvclaw-client.apk') {
        if (!this.apkPath) {
          res.writeHead(404);
          res.end();
          return;
        }
        const st = statSync(this.apkPath);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': st.size,
          'Content-Disposition': 'attachment; filename="tvclaw-client.apk"',
        });
        if (m === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(this.apkPath)
          .pipe(res)
          .on('error', () => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
        return;
      }

      if (m === 'POST' && pathname === '/tv') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c as Buffer));
        req.on('end', () => {
          try {
            const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const { action, params } = parseTvIpcPayload(raw);
            const n = this.sendToAll(action, params);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, tvs: n }));
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      if (m === 'POST' && pathname === '/vibe-key') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c as Buffer));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              dir?: string;
            };
            const dir = body.dir;
            const ok = new Set([
              'up',
              'down',
              'left',
              'right',
              'ok',
              'a',
              'b',
              'x',
              'y',
              'start',
              'select',
            ]);
            if (dir && ok.has(dir)) {
              const line = `data: ${dir}\n\n`;
              for (const client of this.sseClients) {
                try {
                  client.write(line);
                } catch {
                  this.sseClients.delete(client);
                }
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      if (m === 'GET' && pathname === '/vibe-key-sse') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write('retry: 2000\n\n');
        this.sseClients.add(res);
        req.on('close', () => this.sseClients.delete(res));
        return;
      }

      if (read && pathname === '/keypad') {
        const htmlPath = path.join(STATIC_DIR, 'keypad.html');
        if (!existsSync(htmlPath)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (m === 'HEAD') res.end();
        else {
          createReadStream(htmlPath)
            .pipe(res)
            .on('error', () => {
              if (!res.headersSent) res.writeHead(500);
              res.end();
            });
        }
        return;
      }

      if (read && pathname === '/tvclaw-logo.png') {
        if (!existsSync(this.logoPath)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/png' });
        if (m === 'HEAD') res.end();
        else {
          createReadStream(this.logoPath)
            .pipe(res)
            .on('error', () => {
              if (!res.headersSent) res.writeHead(500);
              res.end();
            });
        }
        return;
      }

      const gameMatch = /^\/games\/([a-zA-Z0-9_-]+\.html)$/.exec(pathname);
      if (read && gameMatch) {
        const gamePath = path.join(GAMES_DIR, gameMatch[1] ?? '');
        if (!existsSync(gamePath)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (m === 'HEAD') res.end();
        else {
          createReadStream(gamePath)
            .pipe(res)
            .on('error', () => {
              if (!res.headersSent) res.writeHead(500);
              res.end();
            });
        }
        return;
      }

      const vibeMatch = /^\/vibes\/([^/]+)$/.exec(pathname);
      if (read && vibeMatch) {
        const html = this.readVibeFile(vibeMatch[1] ?? '');
        if (html === null) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          if (m === 'HEAD') res.end();
          else res.end('not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        if (m === 'HEAD') res.end();
        else res.end(html);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    this.httpServer.listen(httpPort, () => {
      logger.info(
        { httpPort },
        `tvclaw brain http ${httpPort} (APK, POST /tv, games, keypad)`,
      );
      printLanBanner(httpPort, !!this.apkPath);
    });
  }

  stop(): void {
    for (const key of [...this.targets.keys()]) this.disposeTarget(key);
    this.targets.clear();
    for (const c of this.sockets) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear();
    try {
      this.browser?.stop();
    } catch {
      /* ignore */
    }
    this.browser = null;
    try {
      this.bonjour?.destroy();
    } catch {
      /* ignore */
    }
    this.bonjour = null;
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

let singleton: TvBridge | null = null;

export function getTvBridge(): TvBridge {
  if (!singleton) singleton = new TvBridge();
  return singleton;
}
