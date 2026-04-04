import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';

import { initDatabase, getMainRegisteredGroupJid } from './db.js';

const logger = pino({
  level:
    process.env.TVCLAW_INSTALLER === '1' ||
    process.env.TVCLAW_QUIET_BAILEYS === '1'
      ? 'silent'
      : 'warn',
});
const AUTH_DIR = './store/auth';

function splitChunks(s: string, max: number): string[] {
  if (s.length <= max) {
    return [s];
  }
  const out: string[] = [];
  let rest = s;
  while (rest.length) {
    out.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  return out;
}

async function waitOpen(sock: ReturnType<typeof makeWASocket>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('WhatsApp connection timeout')),
      120_000,
    );
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        if (reason === DisconnectReason.loggedOut) {
          clearTimeout(t);
          reject(new Error('Logged out'));
        } else if (reason === 515) {
          console.log(
            '\n⟳ Brief WhatsApp stream hiccup (515) — waiting for reconnect…',
          );
        }
      }
      if (connection === 'open') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

async function main(): Promise<void> {
  if (process.env.TVCLAW_SKIP_WHATSAPP === '1') {
    process.exit(0);
  }

  initDatabase();
  const jid = getMainRegisteredGroupJid();
  if (!jid) {
    process.exit(0);
  }

  const httpUrl = (process.env.TVCLAW_APK_HTTP_URL || '').trim();
  const filePath = (process.env.TVCLAW_APK_FILE_PATH || '').trim();
  const viaAdb = process.env.TVCLAW_APK_INSTALLED_VIA_ADB === '1';

  if (!viaAdb && !httpUrl && !filePath) {
    process.exit(0);
  }

  const credPath = path.join(AUTH_DIR, 'creds.json');
  if (!fs.existsSync(credPath)) {
    process.exit(0);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  if (!state.creds.me?.id) {
    process.exit(0);
  }

  const { version } = await fetchLatestWaWebVersion({}).catch(() => ({
    version: undefined as [number, number, number] | undefined,
  }));

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Chrome'),
  });

  sock.ev.on('creds.update', saveCreds);
  await waitOpen(sock);

  let body = '';
  if (viaAdb) {
    body =
      '📺 TVClaw: the TV app was installed on your Android TV from the brain computer using adb. Open the TVClaw app on the TV when you are ready.';
  } else {
    body =
      '📺 TVClaw — install the app on the Android TV only (not on this phone).\n\n';
    if (httpUrl) {
      body += `On the TV, open its web browser and enter this address (same Wi‑Fi):\n${httpUrl}\n\n`;
    }
    if (filePath) {
      body += `Or you can use this computer -> copy the APK file to a USB stick -> open it from the TV’s file manager:\n${filePath}\n\n`;
    }
    body +=
      'If Android blocks the install, use Settings → Apps → Special app access → Install unknown apps on the TV.';
  }

  for (const chunk of splitChunks(body, 3800)) {
    await sock.sendMessage(jid, { text: chunk });
    await new Promise((r) => setTimeout(r, 700));
  }

  sock.end(undefined);
}

main().catch(() => {
  process.exit(0);
});
