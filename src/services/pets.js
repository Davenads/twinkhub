import { EmbedBuilder } from 'discord.js';
import { capitalize } from '../lib/text.js';
import { bracketPets } from '../content/store.js';
import { EMBED_COLOR, LIMITS, truncate, field, metaTitle, metaFooter, degradeEmbed } from '../lib/embed.js';

const familyLabel = (family) => family.split('-').map(capitalize).join(' ');

function familyField(f) {
  const meta = [];
  if (f.keyAbility) meta.push(`Ability: ${f.keyAbility}`);
  if (f.attackSpeed) meta.push(`${f.attackSpeed}s swing`);
  if (f.tameLevel != null) meta.push(`Tame lvl ${f.tameLevel}`);
  if (f.zone) meta.push(f.zone);
  const value = meta.length ? `${f.notes}\n_${meta.join(' \u00b7 ')}_` : f.notes;
  return field(`${familyLabel(f.family)} \u2014 ${f.exampleName}`, value);
}

export function renderPets({ store, bracket, family = null }) {
  const pets = bracketPets(store, bracket);
  const meta = store?.brackets?.[bracket]?.meta;
  const degrade = (msg) => ({ embeds: [degradeEmbed('Hunter Pets', msg)] });

  if (!pets) return degrade(`No pet data is loaded for bracket **${bracket}**.`);

  let families = pets.families;
  if (family) {
    const key = String(family).toLowerCase();
    families = families.filter((f) => f.family === key);
    if (!families.length) {
      return degrade(`No pet family **${familyLabel(key)}** is authored for bracket **${bracket}**.`);
    }
  }

  const title = metaTitle('Hunter Pets', meta);
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title).setDescription(truncate(pets.xpNote, LIMITS.description));
  for (const f of families) embed.addFields(familyField(f));

  // Extra management notes only clutter a single-family filter; show on the full view.
  if (!family) {
    if (pets.abilityNote) embed.addFields(field('Ability shopping', pets.abilityNote));
    if (pets.budgetNote) embed.addFields(field('XP budgeting', pets.budgetNote));
  }

  const footerText = metaFooter(meta);
  if (footerText) embed.setFooter({ text: footerText });

  return { embeds: [embed] };
}
