import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import tty from 'tty';
import { stdin as stdinStream, stdout as stdoutStream } from 'process';

import { readEnvFile } from './env.js';

type InteractiveStreams = {
  stdin: NodeJS.ReadStream & {
    isTTY: boolean;
    setRawMode(mode: boolean): void;
  };
  stdout: NodeJS.WriteStream & { isTTY: boolean };
};

function tryControllingTerminal(): InteractiveStreams | null {
  if (process.platform === 'win32') return null;
  try {
    const inFd = fs.openSync('/dev/tty', 'r');
    const outFd = fs.openSync('/dev/tty', 'w');
    return {
      stdin: new tty.ReadStream(inFd),
      stdout: new tty.WriteStream(outFd),
    };
  } catch {
    return null;
  }
}

function interactiveStreams(): InteractiveStreams | null {
  if (stdinStream.isTTY && stdoutStream.isTTY) {
    return {
      stdin: stdinStream as InteractiveStreams['stdin'],
      stdout: stdoutStream as InteractiveStreams['stdout'],
    };
  }
  return tryControllingTerminal();
}

const DEFAULT_ONECLI_ORIGIN = 'http://127.0.0.1:10254';

function prependLocalBinToPath(): void {
  const local = path.join(os.homedir(), '.local', 'bin');
  if (fs.existsSync(local) && !process.env.PATH?.includes(local)) {
    process.env.PATH = `${local}${path.delimiter}${process.env.PATH ?? ''}`;
  }
}

function stripBracketedPasteWrappers(s: string): string {
  return s.replace(/\u001b\[200~/g, '').replace(/\u001b\[201~/g, '');
}

function ask(prompt: string): Promise<string> {
  const term = interactiveStreams();
  const input = term?.stdin ?? stdinStream;
  const output = term?.stdout ?? stdoutStream;
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(prompt, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

function askSecret(prompt: string): Promise<string> {
  const term = interactiveStreams();
  if (!term?.stdin.isTTY || !term.stdout.isTTY) {
    stdoutStream.write(`\n${prompt}`);
    console.log(
      '(Could not open your terminal for hidden input; typed characters may show. Open Terminal.app or iTerm, cd into your Nanoclaw folder, and run: npm run auth:ai)',
    );
    return ask('Paste API key, then Enter: ');
  }
  const inStream = term.stdin;
  const outStream = term.stdout;
  return new Promise((resolve) => {
    const buf: string[] = [];
    outStream.write(`\n${prompt}`);
    inStream.setRawMode(true);
    inStream.resume();
    const cleanup = () => {
      inStream.setRawMode(false);
      inStream.removeListener('data', onData);
      inStream.pause();
      if (typeof inStream.unref === 'function') {
        inStream.unref();
      }
    };
    const onData = (chunk: Buffer) => {
      const s = stripBracketedPasteWrappers(chunk.toString('utf8'));
      for (const c of s) {
        if (c === '\n' || c === '\r' || c === '\u0004') {
          cleanup();
          outStream.write('\n');
          resolve(buf.join('').trim());
          return;
        }
        if (c === '\u0003') {
          cleanup();
          outStream.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') {
          if (buf.length) {
            buf.pop();
            outStream.write('\b \b');
          }
          continue;
        }
        if (c >= ' ' && c <= '~') {
          buf.push(c);
          outStream.write('*');
        }
      }
    };
    inStream.on('data', onData);
  });
}

function onecliOrigin(): string {
  const fromFile = readEnvFile(['ONECLI_URL']).ONECLI_URL;
  const raw = (
    process.env.ONECLI_URL ||
    fromFile ||
    DEFAULT_ONECLI_ORIGIN
  ).replace(/\/$/, '');
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_ONECLI_ORIGIN;
  }
}

function ensureEnvKeyValue(key: string, value: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    /* new file */
  }
  const re = new RegExp(`^${key}=`, 'm');
  if (re.test(content)) return;
  const prefix = content && !content.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(envPath, `${prefix}${key}=${value}\n`, 'utf8');
  console.log(`Appended ${key}=… to .env`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gatewayHealthy(origin: string): Promise<boolean> {
  const url = `${origin}/api/health`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitForGateway(origin: string, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await gatewayHealthy(origin)) return true;
    await sleep(1000);
  }
  return false;
}

function isLocalOneCliOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

function canAutoInstallShell(): boolean {
  return process.platform !== 'win32';
}

function curlPipeSh(url: string): boolean {
  const r = spawnSync('sh', ['-c', `curl -fsSL "${url}" | sh`], {
    stdio: 'inherit',
    env: process.env,
  });
  return (r.status ?? 1) === 0;
}

function installOneCliGatewayAndCli(): boolean {
  if (!canAutoInstallShell()) return false;
  console.log('Installing OneCLI gateway (official installer)…');
  if (!curlPipeSh('https://onecli.sh/install')) return false;
  console.log('Installing OneCLI CLI…');
  if (!curlPipeSh('https://onecli.sh/cli/install')) return false;
  prependLocalBinToPath();
  return true;
}

function installOneCliCliOnly(): boolean {
  if (!canAutoInstallShell()) return false;
  console.log('Installing OneCLI CLI…');
  if (!curlPipeSh('https://onecli.sh/cli/install')) return false;
  prependLocalBinToPath();
  return true;
}

async function ensureOneCliAndGateway(origin: string): Promise<string> {
  prependLocalBinToPath();
  const local = isLocalOneCliOrigin(origin);
  let exe = resolveOnecliExe();

  if (!exe) {
    if (!canAutoInstallShell()) {
      console.error('');
      console.error(
        'Automatic OneCLI install needs macOS/Linux (or WSL). Install from https://onecli.sh',
      );
      console.error('');
      process.exit(1);
    }
    console.log('onecli not found — installing…');
    const ok = local ? installOneCliGatewayAndCli() : installOneCliCliOnly();
    if (!ok) {
      console.error('OneCLI install script failed.');
      process.exit(1);
    }
    exe = resolveOnecliExe();
    if (!exe) {
      console.error(
        'onecli still not on PATH. Add: export PATH="$HOME/.local/bin:$PATH"',
      );
      process.exit(1);
    }
  }

  run(exe, ['config', 'set', 'api-host', origin], true);

  if (await gatewayHealthy(origin)) {
    console.log('✓ Gateway health OK');
    return exe;
  }

  if (!local) {
    console.error('');
    console.error(
      'Cannot reach',
      `${origin}/api/health`,
      '— fix ONECLI_URL or the remote gateway.',
    );
    console.error('');
    process.exit(1);
  }

  console.log('Starting OneCLI gateway…');
  run(exe, ['start'], true);
  if (await waitForGateway(origin, 45000)) {
    console.log('✓ Gateway health OK');
    return exe;
  }

  console.log('Gateway still down — re-running OneCLI installers…');
  if (!installOneCliGatewayAndCli()) {
    console.error('Repair install failed.');
    process.exit(1);
  }
  exe = resolveOnecliExe();
  if (!exe) {
    console.error('onecli missing after repair install.');
    process.exit(1);
  }
  run(exe, ['config', 'set', 'api-host', origin], true);
  console.log('Starting OneCLI gateway…');
  run(exe, ['start'], true);
  if (!(await waitForGateway(origin, 60000))) {
    console.error('');
    console.error('Gateway did not become healthy. Try manually: onecli start');
    console.error('');
    process.exit(1);
  }
  console.log('✓ Gateway health OK');
  return exe;
}

function resolveOnecliExe(): string | null {
  const r = spawnSync('onecli', ['version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status === 0) return 'onecli';
  const local = path.join(os.homedir(), '.local', 'bin', 'onecli');
  if (fs.existsSync(local)) {
    const r2 = spawnSync(local, ['version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r2.status === 0) return local;
  }
  return null;
}

function run(
  exe: string,
  args: string[],
  inherit: boolean,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(exe, args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: r.status,
    stdout: (r.stdout as string) ?? '',
    stderr: (r.stderr as string) ?? '',
  };
}

function needsAuth(
  stderr: string,
  stdout: string,
  status: number | null,
): boolean {
  const t = `${stderr}${stdout}`;
  return (
    status !== 0 &&
    (/AUTH_REQUIRED|Unauthorized/i.test(t) ||
      /"code"\s*:\s*"AUTH_REQUIRED"/.test(t))
  );
}

function parseSecretsListJson(stdout: string): unknown[] | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const j = JSON.parse(trimmed) as unknown;
    return Array.isArray(j) ? j : null;
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start === -1 || end <= start) return null;
    try {
      const j = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      return Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  }
}

function rowIsAnthropicVaultSecret(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const o = row as Record<string, unknown>;
  const t = String(o.type ?? o.Type ?? '').toLowerCase();
  if (t === 'anthropic') return true;
  const host = String(o.hostPattern ?? o.HostPattern ?? '').toLowerCase();
  if (
    host === 'api.anthropic.com' ||
    host.endsWith('.anthropic.com') ||
    host.includes('anthropic.com')
  ) {
    return true;
  }
  const n = String(o.name ?? o.Name ?? '')
    .trim()
    .toLowerCase();
  return n === 'anthropic';
}

function vaultListsAnthropicSecret(stdout: string): boolean {
  const rows = parseSecretsListJson(stdout);
  if (!rows) return false;
  return rows.some(rowIsAnthropicVaultSecret);
}

function stripCredentialLinesFromEnv(keys: string[]): void {
  const envPath = path.join(process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  const keySet = new Set(keys);
  const next = content
    .split('\n')
    .filter((line) => {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line.trim());
      return !(m && keySet.has(m[1]));
    })
    .join('\n');
  if (next !== content) fs.writeFileSync(envPath, next, 'utf8');
}

async function main(): Promise<void> {
  prependLocalBinToPath();

  console.log('');
  console.log('Connect Claude for your TV assistant');
  console.log('Your API key stays on this computer (encrypted storage).');
  console.log('');

  ensureEnvKeyValue('ONECLI_URL', 'http://127.0.0.1:10254');

  const origin = onecliOrigin();
  console.log(`Key storage service: ${origin}`);

  const exe = await ensureOneCliAndGateway(origin);

  let list = run(exe, ['secrets', 'list'], false);
  if (needsAuth(list.stderr, list.stdout, list.status)) {
    console.log('');
    console.log(
      'Please sign in once so this app can save your key (follow the prompts below).',
    );
    const st = run(exe, ['auth', 'login'], true);
    if (st.status !== 0) {
      console.error('auth login did not complete successfully.');
      process.exit(1);
    }
    list = run(exe, ['secrets', 'list'], false);
  }

  if (list.status !== 0 && !needsAuth(list.stderr, list.stdout, list.status)) {
    console.error(list.stderr || list.stdout || 'secrets list failed');
    process.exit(1);
  }

  if (vaultListsAnthropicSecret(list.stdout)) {
    console.log('');
    console.log(
      '✓ A Claude (Anthropic) API key is already saved. You can continue.',
    );
    console.log('');
    process.exit(0);
  }

  const fromEnv = readEnvFile(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  let value = '';
  if (fromEnv.ANTHROPIC_API_KEY) {
    const y = await ask(
      'Your .env file already has ANTHROPIC_API_KEY. Copy it into secure storage now? [Y/n] ',
    );
    if (!y || y.toLowerCase() === 'y' || y.toLowerCase() === 'yes') {
      value = fromEnv.ANTHROPIC_API_KEY;
    }
  } else if (fromEnv.ANTHROPIC_AUTH_TOKEN) {
    const y = await ask(
      'Your .env file has ANTHROPIC_AUTH_TOKEN. Copy it into secure storage now? [Y/n] ',
    );
    if (!y || y.toLowerCase() === 'y' || y.toLowerCase() === 'yes') {
      value = fromEnv.ANTHROPIC_AUTH_TOKEN;
    }
  }

  if (!value) {
    console.log('');
    console.log('You need a Claude API key (from Anthropic).');
    console.log('');
    console.log('  1) Open https://console.anthropic.com/settings/keys');
    console.log('  2) Create or copy a key.');
    console.log(
      '  3) Click this window, paste the key, then press Enter (typing also works).',
    );
    console.log(
      '     Each character shows as * — nothing is printed in plain text.',
    );
    console.log('');
    value = await askSecret('Paste or type your key here, then Enter: ');
  }

  if (!value) {
    console.error('No value entered.');
    process.exit(1);
  }

  const cr = run(
    exe,
    [
      'secrets',
      'create',
      '--name',
      'Anthropic',
      '--type',
      'anthropic',
      '--value',
      value,
      '--host-pattern',
      'api.anthropic.com',
    ],
    false,
  );
  if (cr.status !== 0) {
    console.error(cr.stderr || cr.stdout || 'secrets create failed');
    process.exit(1);
  }
  console.log('✓ API key saved securely on this computer.');

  if (
    value === fromEnv.ANTHROPIC_API_KEY ||
    value === fromEnv.ANTHROPIC_AUTH_TOKEN
  ) {
    const y = await ask(
      'Remove the key from .env now that it is in secure storage? (recommended) [Y/n] ',
    );
    if (!y || y.toLowerCase() === 'y' || y.toLowerCase() === 'yes') {
      stripCredentialLinesFromEnv([
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'ANTHROPIC_AUTH_TOKEN',
      ]);
      console.log('✓ Removed credential keys from .env');
    }
  }

  console.log('');
  console.log(
    'Done. Continue the installer, or start the brain from your TVClaw folder when you are ready.',
  );
  console.log('To review saved keys later, open', origin, 'in a browser.');
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
