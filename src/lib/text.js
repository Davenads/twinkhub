/** Uppercase the first character of a string (presentation helper). */
export function capitalize(s) {
  const str = String(s ?? '');
  return str.length ? str[0].toUpperCase() + str.slice(1) : str;
}

// Presentation labels for stat-priority tokens. Stamina reads "Stamina/HP"
// because the common flat +HP enchants (head/legs) stack toward the same
// effective-health goal; `healing` is the priest's throughput token. Any token
// not listed here just capitalizes.
const STAT_LABELS = { stamina: 'Stamina/HP', healing: '+Healing' };

/**
 * Format a stat-priority token list into a "A > B > C" display string, applying
 * the presentation labels above. Backs the single stat-priority line shown by
 * `/class` and the class-overview panel hub.
 */
export function formatStatPriority(tokens) {
  if (!Array.isArray(tokens)) return '';
  return tokens.map((t) => STAT_LABELS[String(t).toLowerCase()] ?? capitalize(t)).join(' > ');
}
