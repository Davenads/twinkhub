import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR, truncate, field, LIMITS } from './embed.js';
import { logger } from './logger.js';
import { parseCustomId } from '../services/panels.js';

// Audit logging (P?). Every executed slash command and every panel button/select
// click is posted as one embed to a configured log channel so admins can see who
// invoked what, when, with which args — visibility the ephemeral panel replies
// otherwise hide. This module is the cross-cutting audit shell: pure formatters
// (unit-tested) plus one impure sink (`postAudit`) that serializes sends through
// a small spaced queue so a busy panel session can't 429-flood the channel.
//
// Disabled unless `AUDIT_LOG_CHANNEL_ID` is set (so dev, which has no such
// channel, never tries to post). The channel id is read from env, not hardcoded,
// to keep it out of source and ready for a Heroku config-var move.

const ERROR_COLOR = 0xed4245; // Discord danger red for failed interactions.

// Discord ApplicationCommandOptionType: SUB_COMMAND = 1, SUB_COMMAND_GROUP = 2.
const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

// Friendly labels for the panel `customId` action codes (mirrors the HANDLERS
// map in components/panels.js) so a click reads as "Panel: Enchants (slot)"
// rather than the raw "eslot".
const PANEL_ACTION_LABELS = {
  pick: 'Class pick',
  bis: 'BiS',
  eslot: 'Enchants (slot)',
  ench: 'Enchants (class)',
  cons: 'Consumables (type)',
  consc: 'Consumables (class)',
  sw: 'Stat Weights',
  scoef: 'Spell Scaling',
  talents: 'Talents',
  pets: 'Pets',
  xprules: 'XP Rules',
  tierlist: 'Tier List',
  guide: 'Guide',
  gearpage: 'Gear page nav'
};

function fmtVal(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Describe a chat-input interaction as `{ title, args }`. Walks `options.data`
 * so nested sub-command / group names extend the title (`/panels refresh`) while
 * leaf options flatten to a `name=value` arg string (`class=hunter build=x`).
 */
export function describeChatInput(interaction) {
  const data = interaction.options?.data ?? [];
  const path = [];
  const args = [];
  const walk = (opts) => {
    for (const o of opts) {
      if (o.type === SUB_COMMAND || o.type === SUB_COMMAND_GROUP) {
        path.push(o.name);
        walk(o.options ?? []);
      } else {
        args.push(`${o.name}=${fmtVal(o.value)}`);
      }
    }
  };
  walk(data);
  const title = ['/' + (interaction.commandName ?? 'unknown'), ...path].join(' ');
  return { title, args: args.join(' ') };
}

/**
 * Describe a panel button/select interaction as `{ title, args }`. Decodes the
 * versioned customId to a friendly action label and appends any chosen select
 * values. Stale/foreign ids are reported rather than dropped.
 */
export function describePanel(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) {
    return { title: 'Panel: unknown control', args: fmtVal(interaction.customId) };
  }
  const label = PANEL_ACTION_LABELS[parsed.action] ?? parsed.action;
  const parts = [...parsed.args];
  for (const v of interaction.values ?? []) parts.push(`\u2192 ${v}`);
  return { title: `Panel: ${label}`, args: parts.filter(Boolean).join(' ') };
}

/**
 * Build the audit embed for one interaction. Pure — takes the interaction plus
 * an `outcome` ({ ok } or { ok:false, error }) and elapsed `ms`, returns an
 * EmbedBuilder. Mentions are display-only (the sink passes allowedMentions:{}).
 *
 * @param {{ kind:'command'|'panel', interaction:object, outcome?:{ok:boolean,error?:any}, ms?:number }} entry
 * @returns {EmbedBuilder}
 */
export function formatAuditEntry({ kind, interaction, outcome = { ok: true }, ms }) {
  const desc = kind === 'command' ? describeChatInput(interaction) : describePanel(interaction);
  const user = interaction.user ?? {};
  const embed = new EmbedBuilder()
    .setColor(outcome.ok ? EMBED_COLOR : ERROR_COLOR)
    .setTitle(truncate(desc.title, LIMITS.title));

  if (user.tag) {
    const iconURL = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL() : undefined;
    embed.setAuthor(iconURL ? { name: user.tag, iconURL } : { name: user.tag });
  }

  const outcomeText = outcome.ok
    ? 'OK'
    : `Error: ${outcome.error?.message ?? String(outcome.error ?? 'unknown')}`;

  embed.addFields(
    field('Args', desc.args || '\u2014', true),
    field('User', user.id ? `<@${user.id}> (${user.id})` : '\u2014', true),
    field('Channel', interaction.channelId ? `<#${interaction.channelId}>` : 'Direct message', true),
    field('Outcome', outcomeText, true),
    field('Latency', Number.isFinite(ms) ? `${ms} ms` : '\u2014', true)
  );

  const guildName = interaction.guild?.name ?? interaction.guildId ?? 'unknown guild';
  embed.setFooter({ text: truncate(`${guildName} \u00b7 ${interaction.id ?? ''}`, 2048) });
  const ts = interaction.createdAt
    ?? (interaction.createdTimestamp ? new Date(interaction.createdTimestamp) : new Date());
  embed.setTimestamp(ts);
  return embed;
}

// --- Impure sink: a serial, spaced send queue so bursts can't hit channel
// rate limits. Failures (missing channel, no perms) warn ONCE then stay quiet
// so a misconfig can't spam stdout on every interaction. ---

const SPACING_MS = 1200; // floor gap between channel sends
const MAX_QUEUE = 200; // drop rather than grow unbounded if a burst backs up

const queue = [];
let draining = false;
let sendWarned = false;
let queueWarned = false;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function warnOnce(msg, err) {
  if (sendWarned) return;
  sendWarned = true;
  logger.warn(err ? { err } : {}, msg);
}

async function sendOne({ client, channelId, embed }) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      warnOnce(`audit: channel ${channelId} is not a sendable text channel`);
      return;
    }
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    warnOnce('audit: failed to post to log channel', err);
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      await sendOne(queue.shift());
      if (queue.length) await delay(SPACING_MS);
    }
  } finally {
    draining = false;
  }
}

/**
 * Enqueue an audit post for one interaction. Fire-and-forget: never awaited on
 * the interaction path so it can't add latency or break the user's reply. No-op
 * when `AUDIT_LOG_CHANNEL_ID` is unset (feature disabled, e.g. in dev).
 *
 * @param {import('discord.js').Client} client
 * @param {{ kind:'command'|'panel', interaction:object, outcome?:object, ms?:number }} entry
 */
export function postAudit(client, entry) {
  // Read the optional audit channel straight from the environment (like
  // logger.js reads LOG_LEVEL) rather than importing the validated `env`. That
  // keeps this module — and the pure formatters above — free of any dependency
  // on env *validation*, so importing it for unit tests never requires real
  // secrets (DISCORD_TOKEN etc). By the time an interaction fires at runtime,
  // the entry point has already loaded env.js → dotenv, so this is populated.
  const channelId = process.env.AUDIT_LOG_CHANNEL_ID?.trim() || null;
  if (!channelId) return;
  let embed;
  try {
    embed = formatAuditEntry(entry);
  } catch (err) {
    logger.warn({ err }, 'audit: failed to format entry');
    return;
  }
  if (queue.length >= MAX_QUEUE) {
    if (!queueWarned) {
      queueWarned = true;
      logger.warn('audit: queue full, dropping entries');
    }
    return;
  }
  queue.push({ client, channelId, embed });
  void drain();
}
