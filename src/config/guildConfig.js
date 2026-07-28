import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '../../data/config');

/** Defaults applied on read; new keys added here are backfilled automatically. */
export const DEFAULT_CONFIG = {
  alertChannelId: null,
  alertRoleId: null,
  dmEnabled: true,
  activeBrackets: ['19'],
  timers: { bg: true, agm: true, dmf: true, stv: true },
  // Persistent auto-updating dashboard message; null until /timerboard is run.
  timerBoard: null // { channelId, messageId }
};

function fileFor(guildId) {
  return path.join(CONFIG_DIR, `${guildId}.json`);
}

async function ensureDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/** Load a guild's config merged over defaults. Missing file => defaults. */
export async function loadGuildConfig(guildId) {
  try {
    const raw = await fs.readFile(fileFor(guildId), 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw err;
  }
}

/** Shallow-merge `patch` into a guild's config and persist. Returns the saved config. */
export async function saveGuildConfig(guildId, patch) {
  await ensureDir();
  const current = await loadGuildConfig(guildId);
  const next = { ...current, ...patch };
  await fs.writeFile(fileFor(guildId), JSON.stringify(next, null, 2));
  return next;
}

/** Convenience toggle for the per-guild DM fan-out flag. */
export async function setDmEnabled(guildId, enabled) {
  return saveGuildConfig(guildId, { dmEnabled: Boolean(enabled) });
}
