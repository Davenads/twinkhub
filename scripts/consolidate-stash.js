// One-time maintenance: consolidate duplicate Community Stash rows into a single
// survivor (see plans/14-community-stash.md). All SQL lives in src/stash/store.js;
// this script only orchestrates discovery + reporting and calls the store seam.
//
// Usage (run with dotenv so DATABASE_URL is loaded from .env):
//   npm run stash:consolidate -- --guild <guildId>              # dry-run report
//   npm run stash:consolidate -- --guild <guildId> --apply      # execute merges
//   npm run stash:consolidate -- --guild <guildId> --survivor <id> --dupes a,b,c [--apply]
//
// Auto-discovery is deliberately conservative: it groups by exact wowhead_id, and
// groups null-id rows by normalized name AMONG null-id rows only — so it never
// glues two distinct-id items that merely share a name, and never auto-merges a
// null-id row into an id-bearing one. Use the explicit --survivor/--dupes form
// (operator judgement) for those null-id <-> id-bearing backfill merges.

import {
  isEnabled,
  listItems,
  listRequests,
  consolidateItems,
  shutdown
} from '../src/stash/store.js';

function parseArgs(argv) {
  const args = { apply: false, guild: null, survivor: null, dupes: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--guild') args.guild = argv[++i];
    else if (a === '--survivor') args.survivor = argv[++i];
    else if (a === '--dupes') {
      args.dupes = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return args;
}

const normName = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase();

async function openRequestCount(guildId, itemId) {
  const reqs = await listRequests(guildId, { itemId, statuses: ['pending', 'approved'] });
  return reqs.length;
}

// Group active rows into dupe sets. Survivor = earliest created_at.
async function discover(guildId) {
  const items = await listItems(guildId, {
    statuses: ['available', 'requested', 'given'],
    limit: 10000
  });
  const groups = new Map();
  for (const it of items) {
    const key = it.wowheadId != null ? `id:${it.wowheadId}` : `name:${normName(it.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const sorted = [...g].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return { survivor: sorted[0], dupes: sorted.slice(1) };
    });
}

function itemLine(prefix, it, extra = '') {
  return `${prefix}${it.id}  "${it.name}"  [${it.status}] x${it.remaining}/${it.quantity}${extra}`;
}

async function reportGroup(guildId, survivor, dupes) {
  console.log(`\n${itemLine('Survivor  ', survivor)}`);
  for (const d of dupes) {
    const open = await openRequestCount(guildId, d.id);
    const noun = open === 1 ? 'request' : 'requests';
    console.log(itemLine('  + dupe  ', d, `  (${open} open ${noun} to move)`));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!isEnabled()) {
    console.error('DATABASE_URL is not set — nothing to do.');
    process.exitCode = 1;
    return;
  }
  if (!args.guild) {
    console.error('Missing --guild <guildId>.');
    process.exitCode = 1;
    return;
  }

  try {
    // Explicit mode: consolidate one operator-specified set.
    if (args.survivor || args.dupes) {
      if (!args.survivor || !args.dupes?.length) {
        console.error('Explicit mode needs both --survivor <id> and --dupes <id,id,...>.');
        process.exitCode = 1;
        return;
      }
      console.log(`Explicit merge in ${args.guild}: ${args.survivor} <- ${args.dupes.join(', ')}`);
      if (!args.apply) {
        console.log('DRY RUN — re-run with --apply to execute.');
        return;
      }
      const res = await consolidateItems(args.guild, args.survivor, args.dupes);
      console.log(
        `Merged. Survivor now x${res.survivor.remaining}/${res.survivor.quantity} ` +
          `[${res.survivor.status}]; moved ${res.movedRequests.length} open request(s); ` +
          `withdrew ${res.dupeIds.length} dupe(s).`
      );
      return;
    }

    // Auto-discovery mode.
    const groups = await discover(args.guild);
    if (!groups.length) {
      console.log(`No duplicate rows found in ${args.guild}. Nothing to consolidate.`);
      return;
    }
    console.log(`Found ${groups.length} dupe group(s) in ${args.guild}:`);
    for (const { survivor, dupes } of groups) {
      await reportGroup(args.guild, survivor, dupes);
    }
    if (!args.apply) {
      console.log('\nDRY RUN — re-run with --apply to execute these merges.');
      return;
    }
    let mergedGroups = 0;
    let movedTotal = 0;
    for (const { survivor, dupes } of groups) {
      const res = await consolidateItems(
        args.guild,
        survivor.id,
        dupes.map((d) => d.id)
      );
      mergedGroups++;
      movedTotal += res.movedRequests.length;
    }
    console.log(
      `\nDone. Consolidated ${mergedGroups} group(s); moved ${movedTotal} open request(s).`
    );
  } catch (err) {
    console.error('Consolidation failed:', err.message ?? err);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

main();
