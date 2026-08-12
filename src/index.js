import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { loadCommands } from './commands/index.js';
import { handleComponent } from './components/panels.js';
import { isStashComponent, handleStashComponent } from './components/stash.js';
import { postAudit } from './lib/audit.js';
import { runTimerEngine } from './timers/engine.js';
import { createDispatch } from './timers/dispatch.js';
import { createBoardUpdater } from './timers/board.js';
import { createStashRefresher } from './timers/stash.js';
import { createTickLoop } from './timers/loop.js';
import { loadContentStore } from './content/store.js';

const TICK_MS = 60_000;

const client = new Client({
  // GuildMembers is privileged — enable it in the Dev Portal. Needed so role
  // membership is populated for the (P1) DM fan-out.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.commands = await loadCommands();
logger.info(`Loaded ${client.commands.size} command(s): ${[...client.commands.keys()].join(', ')}`);

// Validate + index the authored content store up front (fail loud in dev if a
// file is malformed) so the data commands serve from a known-good cache.
const content = await loadContentStore();
logger.info(
  `Loaded content store: schema v${content.schemaVersion}, brackets [${content.bracketKeys.join(', ')}]`
);

client.once(Events.ClientReady, (c) => {
  logger.info(`Online as ${c.user.tag} (${c.user.id})`);

  // 60s tick: compute states, resolve edge/warning triggers, persist latches,
  // then fan each fired trigger out to configured guilds (ping / silent
  // broadcast / DM). Finally, refresh each guild's persistent timer board from
  // the same state snapshot (editing in place, reposting if it was deleted).
  const dispatch = createDispatch(client);
  const updateBoards = createBoardUpdater(client);
  const runStashRefresh = createStashRefresher(client);
  const runTick = async () => {
    const now = Date.now();
    const { fires, states } = await runTimerEngine({ now, dispatch });
    if (fires.length) logger.info(`Timer engine fired ${fires.length} trigger(s)`);
    await updateBoards({ states, now });
    // Community Stash upkeep runs on the same tick but is fully isolated: a stash
    // failure must never abort the timer board or trigger fan-out. No-ops when the
    // stash store is unconfigured.
    try {
      await runStashRefresh({ now: new Date(now) });
    } catch (err) {
      logger.error({ err }, 'stash refresh failed');
    }
  };
  // Re-entrancy guard: if a tick outruns the interval, drop the overlapping one
  // rather than double-fanning-out or racing the shared latch/board writes.
  createTickLoop({ runTick, intervalMs: TICK_MS, logger }).start();
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Autocomplete arrives as its own interaction type; route it to the command's
  // optional `autocomplete` handler before the chat-input guard below.
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        logger.error({ err, command: interaction.commandName }, 'autocomplete failed');
      }
    }
    return;
  }

  // Persistent enduser panels (P4): buttons/selects fire as their own interaction
  // types. Route them to the component handler, which replies to the clicker
  // ephemerally via the same render services the slash commands use.
  if (interaction.isButton() || interaction.isAnySelectMenu()) {
    const startedAt = Date.now();
    let outcome = { ok: true };
    try {
      // Two independent component routers share this pipeline: the Community
      // Stash (`s1`) and the content panels (`p1`). Fork on the stash codec.
      if (isStashComponent(interaction)) await handleStashComponent(interaction);
      else await handleComponent(interaction);
    } catch (err) {
      outcome = { ok: false, error: err };
      logger.error({ err, customId: interaction.customId }, 'component failed');
      const payload = {
        content: 'Something went wrong with that panel control.',
        flags: MessageFlags.Ephemeral
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    } finally {
      postAudit(client, { kind: 'panel', interaction, outcome, ms: Date.now() - startedAt });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }
  const startedAt = Date.now();
  let outcome = { ok: true };
  try {
    await command.execute(interaction);
  } catch (err) {
    outcome = { ok: false, error: err };
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
  } finally {
    postAudit(client, { kind: 'command', interaction, outcome, ms: Date.now() - startedAt });
  }
});

client.login(env.token);
