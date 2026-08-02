import { REST, Routes } from 'discord.js';
import { env } from './config/env.js';
import { loadCommands } from './commands/index.js';
import { logger } from './lib/logger.js';

const commands = await loadCommands();
const body = [...commands.values()].map((c) => c.data.toJSON());

const rest = new REST({ version: '10' }).setToken(env.token);

if (!env.guildIds.length) {
  logger.error(
    'No target guilds configured. Set DISCORD_GUILD_IDS (comma-separated) in .env — global registration is disabled.'
  );
  process.exitCode = 1;
} else {
  for (const guildId of env.guildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(env.appId, guildId), { body });
      logger.info(
        `Registered ${body.length} command(s) to guild ${guildId}: ${[...commands.keys()].join(', ')}`
      );
    } catch (err) {
      logger.error({ err, guildId }, `Failed to register commands to guild ${guildId}`);
      process.exitCode = 1;
    }
  }
}
