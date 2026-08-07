import { Client, GatewayIntentBits } from 'discord.js';
import { env } from '../src/config/env.js';

// Dev-only one-shot: dump the bot's application emojis (name -> id) so the ids
// can be pasted into data/content/emoji.json. Application emojis render in every
// guild the bot is in with the markup `<:name:id>` — no per-guild upload needed.
// Re-run after uploading/renaming emojis in the Dev Portal.
//
//   npm run emojis:list                 # tab-separated name/id/animated
//   npm run emojis:list -- --json       # a ready-to-merge emoji.json nodes block

const asJson = process.argv.includes('--json');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async (c) => {
  try {
    const emojis = await c.application.emojis.fetch();
    const rows = [...emojis.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (asJson) {
      const obj = {};
      for (const e of rows)
        obj[e.name] = { name: e.name, id: e.id, ...(e.animated ? { animated: true } : {}) };
      console.log(JSON.stringify(obj, null, 2));
    } else {
      console.log(`# ${rows.length} application emoji(s)`);
      for (const e of rows) console.log(`${e.name}\t${e.id}\t${e.animated ? 'animated' : ''}`);
    }
  } catch (err) {
    console.error('Failed to fetch application emojis:', err);
    process.exitCode = 1;
  } finally {
    await c.destroy();
  }
});

client.login(env.token);
