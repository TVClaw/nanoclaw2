import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import readline from 'readline';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

const AUTH_DIR = './store/auth';
const QR_FILE = './store/qr-data.txt';
const STATUS_FILE = './store/auth-status.txt';

const logger = pino({
  level:
    process.env.TVCLAW_INSTALLER === '1' ||
    process.env.TVCLAW_QUIET_BAILEYS === '1'
      ? 'silent'
      : 'warn',
});

const usePairingCode = process.argv.includes('--pairing-code');
const useBrowserQr = process.argv.includes('--browser-qr');
const phoneArg = process.argv.find((_, i, arr) => arr[i - 1] === '--phone');

function openQrInBrowser(qrPayload: string, launchBrowser: boolean): void {
  void (async () => {
    const QRMod = await import('qrcode');
    const QRCode = QRMod.default as {
      toDataURL: (s: string, o?: object) => Promise<string>;
    };
    const dataUrl = await QRCode.toDataURL(qrPayload, {
      margin: 2,
      width: 512,
    });
    const htmlPath = path.join(process.cwd(), 'store', 'whatsapp-qr.html');
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(
      htmlPath,
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>WhatsApp — TVClaw</title></head><body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;max-width:36rem;margin:0 auto;padding:24px;line-height:1.5"><h1 style="margin-bottom:0.5rem">Link WhatsApp to TVClaw</h1><p style="color:#444">On your phone: <strong>Settings → Linked devices → Link a device</strong>, then scan this code.</p><p style="color:#666;font-size:0.95rem">The code refreshes every so often. If scanning fails, press <strong>Refresh</strong> in this window (or Cmd+R / F5) to load the latest code.</p><p style="color:#444">When WhatsApp says you’re linked, return to the installer on this computer.</p><img alt="QR code for WhatsApp" src="${dataUrl}" width="512" height="512" style="max-width:100%;height:auto;margin-top:16px"/></body></html>`,
    );
    if (!launchBrowser) {
      return;
    }
    const abs = path.resolve(htmlPath);
    try {
      if (process.platform === 'darwin') {
        execFileSync('open', [abs], { stdio: 'ignore' });
      } else if (process.platform !== 'win32') {
        execFileSync('xdg-open', [abs], { stdio: 'ignore' });
      }
    } catch {
      /* ignore */
    }
  })();
}

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function connectSocket(
  phoneNumber?: string,
  isReconnect = false,
): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (state.creds.me?.id && !isReconnect) {
    fs.writeFileSync(STATUS_FILE, 'already_authenticated');
    console.log('✓ This computer is already linked to WhatsApp.');
    console.log(
      '  To link a different account, remove the folder store/auth in this project and run this step again.',
    );
    process.exit(0);
  }

  const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
    logger.warn(
      { err },
      'Failed to fetch latest WA Web version, using default',
    );
    return { version: undefined };
  });
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

  let qrBannerPrinted = false;
  let browserQrLaunched = false;

  if (usePairingCode && phoneNumber && !state.creds.me) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber!);
        console.log(`\n🔗 Your pairing code: ${code}\n`);
        console.log('  1. Open WhatsApp on your phone');
        console.log('  2. Tap Settings → Linked Devices → Link a Device');
        console.log('  3. Tap "Link with phone number instead"');
        console.log(`  4. Enter this code: ${code}\n`);
        fs.writeFileSync(STATUS_FILE, `pairing_code:${code}`);
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : String(err);
        console.error('Failed to request pairing code:', m);
        process.exit(1);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      fs.writeFileSync(QR_FILE, qr);
      if (!qrBannerPrinted) {
        qrBannerPrinted = true;
        console.log('Link WhatsApp to TVClaw — scan the code below.\n');
        console.log(
          '  On your phone: Settings → Linked devices → Link a device',
        );
        if (useBrowserQr) {
          console.log(
            '  A browser page opens once with a large code; it updates on refresh if the code expires.\n',
          );
        } else {
          console.log(
            '  The code in the terminal may refresh — keep scanning until it links.\n',
          );
        }
      }
      if (useBrowserQr) {
        openQrInBrowser(qr, !browserQrLaunched);
        browserQrLaunched = true;
      }
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = (
        lastDisconnect?.error as { output?: { statusCode?: number } }
      )?.output?.statusCode;

      if (reason === DisconnectReason.loggedOut) {
        fs.writeFileSync(STATUS_FILE, 'failed:logged_out');
        console.log('\n✗ Logged out. Delete store/auth and try again.');
        process.exit(1);
      } else if (reason === DisconnectReason.timedOut) {
        fs.writeFileSync(STATUS_FILE, 'failed:qr_timeout');
        console.log('\n✗ QR code timed out. Please try again.');
        process.exit(1);
      } else if (reason === 515) {
        console.log('\n⟳ Stream error (515) after pairing — reconnecting...');
        connectSocket(phoneNumber, true);
      } else {
        fs.writeFileSync(STATUS_FILE, `failed:${reason || 'unknown'}`);
        console.log('\n✗ Connection failed. Please try again.');
        process.exit(1);
      }
    }

    if (connection === 'open') {
      fs.writeFileSync(STATUS_FILE, 'authenticated');
      try {
        fs.unlinkSync(QR_FILE);
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(path.join(process.cwd(), 'store', 'whatsapp-qr.html'));
      } catch {
        /* ignore */
      }
      console.log(
        '\n✓ WhatsApp on your phone is now linked to TVClaw on this computer.',
      );
      console.log('');
      console.log(
        '  What happens next: the setup will create (or open) your “TVClaw” chat in WhatsApp',
      );
      console.log(
        '  and finish connecting it. If you are using the TVClaw installer, just wait — it continues',
      );
      console.log(
        '  on its own. If you ran this step alone, run:  tvclaw link-whatsapp',
      );
      console.log('');
      setTimeout(() => process.exit(0), 1000);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

async function authenticate(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  try {
    fs.unlinkSync(QR_FILE);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(STATUS_FILE);
  } catch {
    /* ignore */
  }

  let phoneNumber = phoneArg;
  if (usePairingCode && !phoneNumber) {
    phoneNumber = await askQuestion(
      'Enter your phone number (with country code, no + or spaces, e.g. 14155551234): ',
    );
  }

  console.log('Starting WhatsApp authentication...\n');

  await connectSocket(phoneNumber);
}

authenticate().catch((err: unknown) => {
  const m = err instanceof Error ? err.message : String(err);
  console.error('Authentication failed:', m);
  process.exit(1);
});
