import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { requireDevRole } from '../../lib/access.js';
import { EVENTS } from '../../timers/events/index.js';
import { DELIVERY } from '../../timers/triggers.js';
import { createDispatch } from '../../timers/dispatch.js';
import { EVENT_CHOICES } from '../../timers/summary.js';

export const data = new SlashCommandBuilder()
  .setName('testevent')
  .setDescription("Fire an event's alert on demand to verify delivery (dev only).")
  .addStringOption((o) =>
    o
      .setName('event')
      .setDescription('Which event to fire')
      .setRequired(true)
      .addChoices(...EVENT_CHOICES)
  )
  .addBooleanOption((o) =>
    o
      .setName('warning')
      .setDescription('Fire the advance warning instead of the occurrence (AGM/STV only)')
      .setRequired(false)
  );

export async function execute(interaction) {
  if (!(await requireDevRole(interaction))) return;
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const event = interaction.options.getString('event', true);
  const warning = interaction.options.getBoolean('warning') ?? false;
  const kind = warning ? 'warning' : 'occurrence';

  const policy = DELIVERY[event]?.[kind];
  if (!policy) {
    // e.g. warning:true for BG/DMF, which have no advance warning.
    await interaction.reply({
      content: `**${event.toUpperCase()}** has no ${
        warning ? 'advance-warning' : 'occurrence'
      } message.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // DM fan-out can take a moment; defer so we don't hit the 3s reply window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const state = EVENTS[event].getState(Date.now());
  const dispatch = createDispatch(interaction.client);
  const results = await dispatch({
    event,
    kind,
    policy,
    state,
    onlyGuildId: interaction.guildId // scope to this server only
  });

  const r = results.find((x) => x.guildId === interaction.guildId);
  if (!r) {
    await interaction.editReply(
      `Nothing fired here. Run \`/setup\` first, and make sure **${event.toUpperCase()}** ` +
        'is enabled for this server.'
    );
    return;
  }

  const parts = [
    r.channelDelivered
      ? `posted to the alert channel (${policy.channel})`
      : 'channel delivery failed — check the bot can post there'
  ];
  if (policy.dm) parts.push(`DMed ${r.dmsSent} role holder(s)`);

  await interaction.editReply(
    `Fired **${event.toUpperCase()}** ${kind}: ${parts.join(', ')}.`
  );
}
