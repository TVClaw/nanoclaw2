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

const logger = pino({ level: 'warn' });

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

  console.log(
    '\nMain group registered. Use this WhatsApp group to control TVClaw.\n',
  );

  sock.end(undefined);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
