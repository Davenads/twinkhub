import { REST, Routes } from 'discord.js';
import { env } from './config/env.js';
import { loadCommands } from './commands/index.js';
import { logger } from './lib/logger.js';

const commands = await loadCommands();
const body = [...commands.values()].map((c) => c.data.toJSON());

const rest = new REST({ version: '10' }).setToken(env.token);

try {
  if (env.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.appId, env.devGuildId), { body });
    logger.info(
      `Registered ${body.length} command(s) to dev guild ${env.devGuildId}: ${[...commands.keys()].join(', ')}`
    );
  } else {
    await rest.put(Routes.applicationCommands(env.appId), { body });
    logger.info(
      `Registered ${body.length} command(s) globally (may take up to ~1h to propagate): ${[...commands.keys()].join(', ')}`
    );
  }
} catch (err) {
  logger.error({ err }, 'Failed to register commands');
  process.exitCode = 1;
}
