/**
 * A self-guarding interval loop for the timer tick.
 *
 * The tick does async work (state compute → latch persist → Discord fan-out →
 * per-guild board edits) that can occasionally run longer than one interval —
 * e.g. a slow gateway, a rate-limited edit, or many guilds. A naive
 * `setInterval(tick, TICK_MS)` would then start a second tick while the first is
 * still in flight, so two overlapping runs could double-fan-out or race the
 * shared latch/board writes. This guard drops any tick that arrives while the
 * previous one is still running and logs the skip.
 *
 * `runTick` owns the actual work; this factory only owns scheduling and the
 * re-entrancy/error boundary, which keeps it trivially unit-testable with a
 * controllable `runTick` and no Discord client.
 *
 * @param {object} opts
 * @param {() => Promise<void>} opts.runTick - one unit of tick work.
 * @param {number} opts.intervalMs - schedule period.
 * @param {{ warn?: Function, error?: Function }} [opts.logger]
 * @returns {{ tick: () => Promise<boolean>, start: () => void, stop: () => void, isRunning: () => boolean }}
 */
export function createTickLoop({ runTick, intervalMs, logger } = {}) {
  let running = false;
  let timer = null;

  async function tick() {
    if (running) {
      logger?.warn?.('tick skipped: previous tick still running');
      return false;
    }
    running = true;
    try {
      await runTick();
      return true;
    } catch (err) {
      logger?.error?.({ err }, 'tick failed');
      return false;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
    tick();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { tick, start, stop, isRunning: () => running };
}
