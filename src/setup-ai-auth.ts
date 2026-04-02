import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { stdin as stdinStream, stdout as stdoutStream } from 'process';

import { readEnvFile } from './env.js';

const DEFAULT_ONECLI_ORIGIN = 'http://127.0.0.1:10254';

function prependLocalBinToPath(): void {
  const local = path.join(os.homedir(), '.local', 'bin');
  if (fs.existsSync(local) && !process.env.PATH?.includes(local)) {
    process.env.PATH = `${local}${path.delimiter}${process.env.PATH ?? ''}`;
  }
}

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

function askSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdoutStream.write(prompt);
    if (!stdinStream.isTTY || !stdoutStream.isTTY) {
      console.log(
        '(This stdin is not a TTY — the key will echo. Prefer running in a real terminal.)',
      );
      void ask('').then((a) => {
        resolve(a.trim());
      });
      return;
    }
    const buf: string[] = [];
    stdinStream.setRawMode(true);
    stdinStream.resume();
    const cleanup = () => {
      stdinStream.setRawMode(false);
      stdinStream.removeListener('data', onData);
    };
    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const c of s) {
        if (c === '\n' || c === '\r' || c === '\u0004') {
          cleanup();
          stdoutStream.write('\n');
          resolve(buf.join('').trim());
          return;
        }
        if (c === '\u0003') {
          cleanup();
          stdoutStream.write('\n');
          process.exit(130);
        }
        if (c === '\u007f' || c === '\b') {
          if (buf.length) {
            buf.pop();
            stdoutStream.write('\b \b');
          }
          continue;
        }
        if (c >= ' ' && c <= '~') {
          buf.push(c);
          stdoutStream.write('*');
        }
      }
    };
    stdinStream.on('data', onData);
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

function alreadyHasAnthropicSecret(stdout: string): boolean {
  if (/anthropic/i.test(stdout) && /secret|name|type/i.test(stdout))
    return true;
  try {
    const j = JSON.parse(stdout) as unknown;
    if (!Array.isArray(j)) return false;
    return j.some((row) => {
      if (!row || typeof row !== 'object') return false;
      const o = row as Record<string, unknown>;
      const n = String(o.name ?? o.Name ?? '').toLowerCase();
      const t = String(o.type ?? o.Type ?? '').toLowerCase();
      return n.includes('anthropic') || t === 'anthropic';
    });
  } catch {
    return false;
  }
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
  console.log('TVClaw — connect the AI (OneCLI + Anthropic API key)');
  console.log('(Same idea as npm run auth for WhatsApp.)');
  console.log('');

  ensureEnvKeyValue('ONECLI_URL', 'http://127.0.0.1:10254');

  const origin = onecliOrigin();
  console.log(`Using OneCLI at ${origin}`);

  const exe = await ensureOneCliAndGateway(origin);

  let list = run(exe, ['secrets', 'list'], false);
  if (needsAuth(list.stderr, list.stdout, list.status)) {
    console.log('');
    console.log('OneCLI needs you to log in once in this terminal…');
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

  if (alreadyHasAnthropicSecret(list.stdout)) {
    console.log('');
    console.log('✓ An Anthropic-type secret is already registered.');
    console.log(
      '  Run npm start (or npm run dev:live) and send a WhatsApp message to test.',
    );
    console.log('');
    process.exit(0);
  }

  const fromEnv = readEnvFile(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  let value = '';
  if (fromEnv.ANTHROPIC_API_KEY) {
    const y = await ask(
      'Found ANTHROPIC_API_KEY in .env — register it with OneCLI? [Y/n] ',
    );
    if (!y || y.toLowerCase() === 'y' || y.toLowerCase() === 'yes') {
      value = fromEnv.ANTHROPIC_API_KEY;
    }
  } else if (fromEnv.ANTHROPIC_AUTH_TOKEN) {
    const y = await ask(
      'Found ANTHROPIC_AUTH_TOKEN in .env — register it with OneCLI? [Y/n] ',
    );
    if (!y || y.toLowerCase() === 'y' || y.toLowerCase() === 'yes') {
      value = fromEnv.ANTHROPIC_AUTH_TOKEN;
    }
  }

  if (!value) {
    console.log('');
    console.log(
      'Anthropic API key from https://console.anthropic.com/settings/keys',
    );
    console.log('(Typed characters are hidden.)');
    value = await askSecret('API key: ');
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
  console.log('✓ Secret stored in OneCLI vault');

  if (
    value === fromEnv.ANTHROPIC_API_KEY ||
    value === fromEnv.ANTHROPIC_AUTH_TOKEN
  ) {
    const y = await ask(
      'Remove the credential line(s) from .env now? (recommended) [Y/n] ',
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
  console.log('Done. Start the app with npm start or npm run dev:live.');
  console.log('Optional: open', origin, 'to manage secrets in the UI.');
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
