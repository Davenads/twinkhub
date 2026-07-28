import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Auto-discover command modules under src/commands/ (recursively).
 * A command module exports `data` (a SlashCommandBuilder) and `execute(interaction)`.
 * Returns a Collection keyed by command name.
 */
export async function loadCommands() {
  const commands = new Collection();
  for (const file of await walk(__dirname)) {
    if (!file.endsWith('.js')) continue;
    if (path.basename(file) === 'index.js') continue;
    const mod = await import(pathToFileURL(file).href);
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
