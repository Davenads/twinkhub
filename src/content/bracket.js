import { loadGuildConfig } from '../config/guildConfig.js';
import { primaryBracket } from './store.js';

/**
 * Resolve which bracket a data command serves. The bot is focused on a single
 * bracket, so there is no user-facing `bracket` option: this returns the guild's
 * primary (first enabled) bracket, falling back to "19" outside a guild. Shared
 * by every data command's `execute` and `autocomplete` so the default can never
 * drift between them.
 */
export async function resolveBracket(interaction) {
  const config = interaction.inGuild() ? await loadGuildConfig(interaction.guildId) : null;
  return primaryBracket(config);
}
