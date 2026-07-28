import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { loadCommands } from './commands/index.js';
import { runTimerEngine } from './timers/engine.js';
import { createDispatch } from './timers/dispatch.js';
import { createBoardUpdater } from './timers/board.js';

const TICK_MS = 60_000;

const client = new Client({
  // GuildMembers is privileged — enable it in the Dev Portal. Needed so role
  // membership is populated for the (P1) DM fan-out.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.commands = await loadCommands();
logger.info(
  `Loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(', ')}`
);

client.once(Events.ClientReady, (c) => {
  logger.info(`Online as ${c.user.tag} (${c.user.id})`);

  // 60s tick: compute states, resolve edge/warning triggers, persist latches,
  // then fan each fired trigger out to configured guilds (ping / silent
  // broadcast / DM). Finally, refresh each guild's persistent timer board from
  // the same state snapshot (editing in place, reposting if it was deleted).
  const dispatch = createDispatch(client);
  const updateBoards = createBoardUpdater(client);
  const tick = async () => {
    try {
      const now = Date.now();
      const { fires, states } = await runTimerEngine({ now, dispatch });
      if (fires.length) logger.info(`Timer engine fired ${fires.length} trigger(s)`);
      await updateBoards({ states, now });
    } catch (err) {
      logger.error({ err }, 'tick failed');
    }
  };
  setInterval(tick, TICK_MS);
  tick();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }
  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error({ err, command: interaction.commandName }, 'command failed');
    const payload = {
      content: 'Something went wrong running that command.',
      flags: MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.login(env.token);
