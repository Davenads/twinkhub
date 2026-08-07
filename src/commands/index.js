import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import { logger } from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Auto-discover command modules under src/commands/ (recursively).
 * A command module exports `data` (a SlashCommandBuilder) and `execute(interaction)`.
 * Returns a Collection keyed by command name.
 *
 * A module that fails to import (syntax error, throwing side-effect) is logged and
 * skipped rather than aborting the whole load — one broken command shouldn't take
 * the bot offline. Modules that load fine but lack the command shape
 * (`data.name` + `execute`) are quietly ignored (helpers, index barrels).
 *
 * `dir` is injectable for testing; defaults to the real commands directory.
 */
export async function loadCommands({ dir = __dirname } = {}) {
  const commands = new Collection();
  for (const file of await walk(dir)) {
    if (!file.endsWith('.js')) continue;
    if (path.basename(file) === 'index.js') continue;
    let mod;
    try {
      mod = await import(pathToFileURL(file).href);
    } catch (err) {
      logger.warn({ err, file }, 'skipping command module that failed to import');
      continue;
    }
    if (mod?.data?.name && typeof mod.execute === 'function') {
      commands.set(mod.data.name, mod);
    }
  }
  return commands;
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}
