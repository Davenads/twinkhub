import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../../src/stash/db.js';

const DATABASE_URL = process.env.DATABASE_URL;

// Integration-only smoke test: proves the pg driver + DATABASE_URL wiring end to
// end (the harness the community-stash repository will lean on). It is skipped in
// the default `npm test` — which runs in a secretless CI with no DATABASE_URL — and
// only executes under `npm run test:int` against an ephemeral Postgres (the CI
// `services:` container or a local dev database). Routing through createPool also
// exercises the shared SSL normalisation the runtime store uses.
test('connects to Postgres and runs a trivial query', { skip: !DATABASE_URL }, async () => {
  const pool = createPool(DATABASE_URL, { max: 2 });
  try {
    const { rows } = await pool.query('select 1 as ok');
    assert.equal(rows[0].ok, 1);
  } finally {
    await pool.end();
  }
});
