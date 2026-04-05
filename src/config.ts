import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { isValidTimezone } from './timezone.js';

// Read config values from .env (falls back to process.env).
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'ONECLI_URL',
  'TZ',
  'IDLE_TIMEOUT',
  'MAX_MESSAGES_PER_PROMPT',
  'SESSION_IDLE_RESET_MINUTES',
  'MAX_CONCURRENT_CONTAINERS',
  'NANOCLAW_MAX_AGENT_TURNS',
  'NANOCLAW_MAX_THINKING_TOKENS',
]);

const DEFAULT_IDLE_TIMEOUT_MS = '3600000';
const DEFAULT_MAX_MESSAGES_PER_PROMPT = '8';
const DEFAULT_MAX_CONCURRENT_CONTAINERS = '6';
const DEFAULT_NANOCLAW_MAX_AGENT_TURNS = '35';
const DEFAULT_NANOCLAW_MAX_THINKING_TOKENS = '8192';

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || os.homedir();

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const SENDER_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'sender-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const ONECLI_URL =
  process.env.ONECLI_URL || envConfig.ONECLI_URL || 'http://localhost:10254';
export const MAX_MESSAGES_PER_PROMPT = Math.max(
  1,
  parseInt(
    process.env.MAX_MESSAGES_PER_PROMPT ||
      envConfig.MAX_MESSAGES_PER_PROMPT ||
      DEFAULT_MAX_MESSAGES_PER_PROMPT,
    10,
  ) || parseInt(DEFAULT_MAX_MESSAGES_PER_PROMPT, 10),
);
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || envConfig.IDLE_TIMEOUT || DEFAULT_IDLE_TIMEOUT_MS,
  10,
);
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(
    process.env.MAX_CONCURRENT_CONTAINERS ||
      envConfig.MAX_CONCURRENT_CONTAINERS ||
      DEFAULT_MAX_CONCURRENT_CONTAINERS,
    10,
  ) || parseInt(DEFAULT_MAX_CONCURRENT_CONTAINERS, 10),
);

function resolvedSdkCap(
  key: 'NANOCLAW_MAX_AGENT_TURNS' | 'NANOCLAW_MAX_THINKING_TOKENS',
  defaultValue: string,
): string | undefined {
  const raw = process.env[key]?.trim() ?? envConfig[key]?.trim();
  if (raw === '0' || raw === 'off' || raw === 'false' || raw === 'none') {
    return undefined;
  }
  if (raw) return raw;
  return defaultValue;
}

export const NANOCLAW_MAX_AGENT_TURNS = resolvedSdkCap(
  'NANOCLAW_MAX_AGENT_TURNS',
  DEFAULT_NANOCLAW_MAX_AGENT_TURNS,
);
export const NANOCLAW_MAX_THINKING_TOKENS = resolvedSdkCap(
  'NANOCLAW_MAX_THINKING_TOKENS',
  DEFAULT_NANOCLAW_MAX_THINKING_TOKENS,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTriggerPattern(trigger: string): RegExp {
  return new RegExp(`^${escapeRegex(trigger.trim())}\\b`, 'i');
}

export const DEFAULT_TRIGGER = `@${ASSISTANT_NAME}`;

export function getTriggerPattern(trigger?: string): RegExp {
  const normalizedTrigger = trigger?.trim();
  return buildTriggerPattern(normalizedTrigger || DEFAULT_TRIGGER);
}

export const TRIGGER_PATTERN = buildTriggerPattern(DEFAULT_TRIGGER);

// Timezone for scheduled tasks, message formatting, etc.
// Validates each candidate is a real IANA identifier before accepting.
function resolveConfigTimezone(): string {
  const candidates = [
    process.env.TZ,
    envConfig.TZ,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  for (const tz of candidates) {
    if (tz && isValidTimezone(tz)) return tz;
  }
  return 'UTC';
}
export const TIMEZONE = resolveConfigTimezone();

export const VERBOSE = process.argv.includes('--verbose');

export const MACOS_DESKTOP_NOTIFY = process.env.TVCLAW_MACOS_NOTIFY === '1';

export const SESSION_IDLE_RESET_MINUTES = Math.max(
  0,
  parseInt(
    process.env.SESSION_IDLE_RESET_MINUTES ||
      envConfig.SESSION_IDLE_RESET_MINUTES ||
      '0',
    10,
  ) || 0,
);

export function isAgentDryRun(): boolean {
  const v = process.env.TVCLAW_AGENT_DRY_RUN;
  return v === '1' || v === 'true';
}
