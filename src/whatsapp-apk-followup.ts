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

type WaConnectionUpdate = {
  connection?: 'open' | 'close' | 'connecting';
  lastDisconnect?: { error?: unknown };
};

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
  if (process.env.TVCLAW_INSTALLER === '1') {
    console.error(
      'TVClaw: posting TV instructions — connecting to WhatsApp (wait up to ~2 min; stop other nanoclaw/npm start on this machine if this takes forever)…',
    );
  }
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(
            'WhatsApp connection timeout — stop any other TVClaw brain using this folder, then re-run the installer or: cd nanoclaw2 && npx tsx src/whatsapp-apk-followup.ts',
          ),
        ),
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

  const withTimeout = <T>(
    p: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> => {
    let to: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<never>((_, rej) => {
      to = setTimeout(() => rej(new Error(`${label} (${ms}ms)`)), ms);
    });
    return Promise.race([p, timeoutP]).finally(() => {
      if (to) clearTimeout(to);
    }) as Promise<T>;
  };

  let version: [number, number, number] | undefined;
  try {
    const meta = await withTimeout(
      fetchLatestWaWebVersion({}),
      25_000,
      'fetchLatestWaWebVersion',
    );
    version = meta.version;
  } catch {
    version = undefined;
  }

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

  if (process.env.TVCLAW_INSTALLER === '1') {
    console.error(
      'TVClaw: sending install instructions to your WhatsApp group…',
    );
  }

  const accessibilitySteps =
    'Enable TVClaw Accessibility on the TV (needed for remote control):\n' +
    '1) Settings on the TV\n' +
    '2) Device preferences or System → Accessibility\n' +
    '3) Open TVClaw in the installed services list\n' +
    '4) Turn it ON and confirm any prompt\n\n';

  let body = '';
  if (viaAdb) {
    body =
      '📺🦞 TVClaw: the TV app was installed on your Android TV from the brain computer using adb. Open the TVClaw app on the TV when you are ready.\n\n';
    body += accessibilitySteps;
  } else {
    body =
      '📺🦞 TVClaw - install the app on the Android TV only (not on this phone).\n\n';
    if (httpUrl) {
      body += `On the TV, open its web browser and enter this address (same Wi‑Fi):\n${httpUrl}\n\n`;
    }
    if (filePath) {
      body += `Or you can use this computer -> copy the APK file to a USB stick -> open it from the TV’s file manager:\n${filePath}\n\n`;
    }
    body +=
      'If Android blocks the install, use Settings → Apps → Special app access → Install unknown apps on the TV.\n\n';
    body += accessibilitySteps;
  }

  for (const chunk of splitChunks(body, 3800)) {
    await withTimeout(
      sock.sendMessage(jid, { text: chunk }),
      90_000,
      'WhatsApp sendMessage',
    );
    await new Promise((r) => setTimeout(r, 700));
  }

  sock.end(undefined);
}

main().catch((err) => {
  if (process.env.TVCLAW_INSTALLER === '1') {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `TVClaw: could not post TV app instructions to WhatsApp: ${msg}`,
    );
  }
  process.exit(0);
});
