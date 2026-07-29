/** Uppercase the first character of a string (presentation helper). */
export function capitalize(s) {
  const str = String(s ?? '');
  return str.length ? str[0].toUpperCase() + str.slice(1) : str;
}
