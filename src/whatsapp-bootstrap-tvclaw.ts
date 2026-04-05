import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';

const AUTH_DIR = './store/auth';

const logger = pino({
  level:
    process.env.TVCLAW_INSTALLER === '1' ||
    process.env.TVCLAW_QUIET_BAILEYS === '1'
      ? 'silent'
      : 'warn',
});

const groupName =
  (process.env.WHATSAPP_AGENT_GROUP_NAME || 'TVClaw').trim() || 'TVClaw';
const registerName =
  (process.env.WHATSAPP_REGISTER_NAME || groupName).trim() || groupName;
const folder =
  (process.env.WHATSAPP_REGISTER_FOLDER || 'tvclaw').trim() || 'tvclaw';
const assistant = (process.env.ASSISTANT_NAME || 'Andy').trim() || 'Andy';
const trigger = `@${assistant}`;

function resolveLogoPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '..', 'TvClaw_logo.png'),
    path.resolve(process.cwd(), 'assets', 'TvClaw_logo.png'),
    path.resolve(process.cwd(), '..', 'TvClaw', 'TvClaw_logo.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findGroupBySubject(
  groups: Record<string, { subject?: string }>,
  subject: string,
): string | undefined {
  const want = subject.trim().toLowerCase();
  for (const [id, meta] of Object.entries(groups)) {
    if ((meta.subject || '').trim().toLowerCase() === want) {
      return id;
    }
  }
  return undefined;
}

async function setGroupIcon(
  sock: ReturnType<typeof makeWASocket>,
  groupJid: string,
): Promise<void> {
  const logoPath = resolveLogoPath();
  if (!logoPath) {
    console.warn('TVClaw logo not found — skipping group icon');
    return;
  }
  try {
    const imageBuffer = fs.readFileSync(logoPath);
    await sock.updateProfilePicture(groupJid, imageBuffer);
    console.log('Group icon set to TVClaw logo');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Could not set group icon: ${msg}`);
  }
}

async function ensureTvclawGroup(
  sock: ReturnType<typeof makeWASocket>,
): Promise<string> {
  const participating = await sock.groupFetchAllParticipating();
  const existing = findGroupBySubject(participating, groupName);
  if (existing) {
    console.log(`Using existing group "${groupName}": ${existing}`);
    await setGroupIcon(sock, existing);
    return existing;
  }

  const me = sock.user?.id;
  if (!me) {
    throw new Error('WhatsApp session has no user id yet');
  }
  const selfPn = jidNormalizedUser(me);

  let meta: { id: string };
  try {
    meta = await sock.groupCreate(groupName, [selfPn]);
  } catch (first) {
    try {
      meta = await sock.groupCreate(groupName, []);
    } catch {
      throw first;
    }
  }

  console.log(`Created group "${groupName}": ${meta.id}`);
  await setGroupIcon(sock, meta.id);
  return meta.id;
}

function prebuiltApkPathOnBrain(): string {
  const candidates = [
    path.resolve(process.cwd(), '../prebuilt/tvclaw-android.apk'),
    path.resolve(process.cwd(), 'prebuilt/tvclaw-android.apk'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return path.resolve(process.cwd(), '../prebuilt/tvclaw-android.apk');
}

async function postTvSetupGuideToGroup(
  sock: ReturnType<typeof makeWASocket>,
  groupJid: string,
): Promise<void> {
  const apkPath = prebuiltApkPathOnBrain();
  const parts = [
`📺🦞 Welcome to ${groupName}. This WhatsApp group is your TV AI Agent.
  
The TVClaw app itself must run on your TV.
  
How to put the TVClaw app on the TV:
• when setup finishes, a download link will be posted in this group — open it in the TV’s browser on the same Wi‑Fi`,
  ];
  for (const text of parts) {
    await sock.sendMessage(groupJid, { text });
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main(): Promise<void> {
  if (process.env.WHATSAPP_SKIP_BOOTSTRAP === '1') {
    console.log('WHATSAPP_SKIP_BOOTSTRAP=1 — skipping group bootstrap');
    process.exit(0);
  }

  if (!fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    console.error('No WhatsApp session. Run npm run auth first.');
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  if (!state.creds.me?.id) {
    console.error('No WhatsApp session in store/auth. Run npm run auth first.');
    process.exit(1);
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
          reject(new Error('Logged out — delete store/auth and link again.'));
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

  let groupJid: string;
  try {
    groupJid = await ensureTvclawGroup(sock);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Group setup failed: ${msg}`);
    console.error(
      `Create a group named "${groupName}" manually, then register via setup.`,
    );
    sock.end(undefined);
    process.exit(1);
  }

  const args = [
    'tsx',
    'setup/index.ts',
    '--step',
    'register',
    '--',
    '--jid',
    groupJid,
    '--name',
    registerName,
    '--folder',
    folder,
    '--trigger',
    trigger,
    '--channel',
    'whatsapp',
    '--is-main',
    '--no-trigger-required',
    '--assistant-name',
    assistant,
  ];
  const reg = spawnSync('npx', args, { stdio: 'inherit', cwd: process.cwd() });
  if (reg.status !== 0) {
    process.exit(reg.status ?? 1);
  }

  try {
    await postTvSetupGuideToGroup(sock, groupJid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Could not post setup tips to WhatsApp: ${msg}`);
  }

  console.log('');
  console.log('────────────────────────────────────────────────────────────');
  console.log('You’re ready to use TVClaw from WhatsApp');
  console.log('────────────────────────────────────────────────────────────');
  console.log('');
  console.log(
    `  • Check the “${groupName}” WhatsApp group — setup steps for the TV were posted there too.`,
  );
  console.log('');
  console.log(
    '  • Chat in that group in plain language to steer the TV. Keep this computer on and online.',
  );
  console.log('');
  console.log(
    `  • On the TV you may see “${assistant}” when the assistant is active.`,
  );
  console.log('');
  console.log(
    '  • The installer continues on this computer: TV app via adb if available, or a link / file path for the TV.',
  );
  console.log('');
  console.log(
    '  • TVClaw’s brain stays in the background on this computer unless you skipped that.',
  );
  console.log('');

  sock.end(undefined);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
