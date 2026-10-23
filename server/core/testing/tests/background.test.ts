import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { advance_time, fake, load_data, login, restart_test_server, send, send_admin, set_time, start_peer_server, start_test_server, stop_test_server, wait_background } from '../dev/index.ts';
import { list_databases } from '../dev/database.ts';
import { core_test_register } from '../dev/runner_input.ts';
import type { Storage } from '../../storage/index.ts';
import { added, error_code, listening_servers, missing, rate_counter_rows, real_wait, resync, server_folders, settled_listening } from './helpers.ts';

/** `server-time.schedule_job` of the core object `register` gets. */
function schedule_job(core: Readonly<Record<string, unknown>>, name: string, interval_ms: bigint, run: () => Promise<void>): void {
  (core['server-time'] as { schedule_job(name: string, interval_ms: bigint, run: () => Promise<void>): void }).schedule_job(name, interval_ms, run);
}

/** A sweep interval longer than a minute window, so that a counter row expires before the next sweep is due. */
const LONG_SWEEP_MS = 600_000;
/** A sweep interval shorter than the real time a test waits. */
const SHORT_SWEEP_MS = 500;

describe('background work', () => {
  it('advance_time over the storage_sweep interval and wait_background remove expired rows', async () => {
    const server = await start_test_server();
    try {
      await resync(await login(server, 'sweep'));
      expect(await rate_counter_rows(server)).toBeGreaterThan(0);
      const interval = BigInt(server.settings()['routing.storageSweepIntervalMs'] as number);
      advance_time(server, interval + 60_000n);
      await wait_background(server);
      expect(await rate_counter_rows(server)).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  });

  it('an expired row stays when advance_time does not pass the storage_sweep interval', async () => {
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, { 'routing.storageSweepIntervalMs': LONG_SWEEP_MS });
    try {
      await resync(await login(server, 'no_sweep'));
      const rows = await rate_counter_rows(server);
      expect(rows).toBeGreaterThan(0);
      advance_time(server, 61_000n);
      await wait_background(server);
      expect(await rate_counter_rows(server)).toBe(rows);
    } finally {
      await stop_test_server(server);
    }
  });

  it('jobs of a LOCAL test server do not run as real time passes', async () => {
    const start = 1_767_225_600_000n;
    const server = await start_test_server(start, undefined, undefined, undefined, undefined, { 'routing.storageSweepIntervalMs': SHORT_SWEEP_MS });
    try {
      // The storage_sweep run of server start is at `start` and has ended when start_test_server returns. Counter rows
      // made two minute windows earlier expire before `start`, so they are expired rows while the clock stays before
      // the next sweep at start + SHORT_SWEEP_MS.
      set_time(server, start - 120_000n);
      const made = await resync(await login(server, 'real_time'));
      expect(made.envelope.server_time_at).toBe(start - 120_000n);
      set_time(server, start + BigInt(SHORT_SWEEP_MS) - 1n);
      const rows = await rate_counter_rows(server);
      expect(rows).toBeGreaterThan(0);
      // Longer than the sweep interval of real time: a scheduler on real time would run storage_sweep.
      await real_wait(SHORT_SWEEP_MS * 3);
      expect(await rate_counter_rows(server)).toBe(rows);
      // The rows are expired: the sweep that the test clock makes due removes them.
      advance_time(server, 1n);
      await wait_background(server);
      expect(await rate_counter_rows(server)).toBe(0);
    } finally {
      await stop_test_server(server);
    }
  });

  it('wait_background throws when an out-of-request change does not end within testing.backgroundWaitTimeoutMs', async () => {
    let finish = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let armed = false;
    const register = (core: Readonly<Record<string, unknown>>): void => {
      // A job that, once armed, ends only when the test lets it.
      schedule_job(core, 'testing_held', 3_600_000n, () => (armed ? held : Promise.resolve()));
      core_test_register(core);
    };
    // The default time limit: start_test_server waits for the job runs of server start under the same limit.
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register);
    try {
      armed = true;
      advance_time(server, 3_600_000n);
      const limit = String(server.settings()['testing.backgroundWaitTimeoutMs']);
      await expect(wait_background(server)).rejects.toThrow(`wait_background did not end within ${limit} ms`);
      finish();
      await wait_background(server);
    } finally {
      finish();
      await stop_test_server(server);
    }
  });

  it('wait_background returns after a job, the after_commit work its commit starts, and the work that work starts in turn', async () => {
    const steps: string[] = [];
    let storage: Storage | null = null;
    let armed = false;
    // Each step ends on real time, so a wait that returned before a step would see it missing.
    const later = async (step: string, then: (() => Promise<unknown>) | null): Promise<void> => {
      await real_wait(30);
      steps.push(step);
      if (then !== null) await then();
    };
    const commit_then = async (on: Storage, step: string, then: (() => Promise<unknown>) | null): Promise<void> => {
      const committed = await on.run_game_transaction((tx) => {
        on.after_commit(tx, () => later(step, then));
      });
      if (committed === 'FAILED') throw new Error('the game transaction failed');
    };
    const register = (core: Readonly<Record<string, unknown>>): void => {
      schedule_job(core, 'testing_chain', 3_600_000n, async () => {
        const on = storage;
        if (!armed || on === null) return;
        await real_wait(30);
        steps.push('job');
        await commit_then(on, 'after_commit', () => commit_then(on, 'chained after_commit', null));
      });
      core_test_register(core);
    };
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register);
    try {
      storage = server.running().instance.modules().get('storage') as unknown as Storage;
      armed = true;
      advance_time(server, 3_600_000n);
      await wait_background(server);
      expect(steps).toEqual(['job', 'after_commit', 'chained after_commit']);
    } finally {
      await stop_test_server(server);
    }
  });

  it('start_test_server, restart_test_server and start_peer_server of a LOCAL test server return after the job runs of server start', async () => {
    const ended: string[] = [];
    let instance = 0;
    const register = (core: Readonly<Record<string, unknown>>): void => {
      const name = `instance ${String((instance += 1))}`;
      // The run of server start ends on real time, after the next turns of the test.
      schedule_job(core, 'testing_start_run', 3_600_000n, async () => {
        await real_wait(200);
        ended.push(name);
      });
      core_test_register(core);
    };
    const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, undefined, register);
    try {
      expect(ended).toEqual(['instance 1']);
      await restart_test_server(server);
      expect(ended).toEqual(['instance 1', 'instance 2']);
      const peer = await start_peer_server(server);
      expect(ended).toEqual(['instance 1', 'instance 2', 'instance 3']);
      // The clock moves at once: no run of server start is still going, so only the runs it makes due start.
      advance_time(peer, 3_600_000n);
      await wait_background(server);
      await wait_background(peer);
      expect(ended.slice(3).sort()).toEqual(['instance 2', 'instance 3']);
    } finally {
      await stop_test_server(server);
    }
  });

  describe('a job run of server start that does not end within testing.backgroundWaitTimeoutMs', () => {
    /** A short wait limit: each case waits it out in real time. */
    const SHORT_WAIT = { 'testing.backgroundWaitTimeoutMs': 1000 };
    const TIMED_OUT = /wait_background did not end within 1000 ms/;
    let finish = (): void => undefined;
    let held = Promise.resolve();
    /** True while the job run of the next server start is held. */
    let holding = false;
    /** A `register` whose job of server start ends only at `finish()` while `holding`. */
    const register = (core: Readonly<Record<string, unknown>>): void => {
      schedule_job(core, 'testing_held_start', 3_600_000n, () => (holding ? held : Promise.resolve()));
      core_test_register(core);
    };

    beforeEach(() => {
      held = new Promise<void>((resolve) => {
        finish = resolve;
      });
      holding = false;
    });
    afterEach(() => {
      finish();
    });

    it.each(['sqlite', 'postgresql'] as const)('makes start_test_server throw and leaves no temporary folder, %s DB or port', async (db) => {
      const folders = server_folders();
      const databases = await list_databases();
      const listening = listening_servers();
      holding = true;
      await expect(start_test_server(undefined, db, undefined, undefined, undefined, SHORT_WAIT, register)).rejects.toThrow(TIMED_OUT);
      expect(added(folders, server_folders())).toEqual([]);
      expect(added(databases, await list_databases())).toEqual([]);
      expect(await settled_listening(listening)).toBeLessThanOrEqual(listening);
    });

    it('makes restart_test_server throw and leaves no temporary folder, PostgreSQL database or port', async () => {
      const listening = listening_servers();
      const server = await start_test_server(undefined, 'postgresql', undefined, undefined, undefined, SHORT_WAIT, register);
      const { port } = server;
      const folder = server.shared.folder;
      const name = server.shared.database.name;
      holding = true;
      await expect(restart_test_server(server)).rejects.toThrow(TIMED_OUT);
      expect(existsSync(folder)).toBe(false);
      expect(await list_databases()).not.toContain(name);
      expect(await settled_listening(listening)).toBeLessThanOrEqual(listening);
      await expect(fetch(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
    });

    it('makes start_peer_server throw and leaves no peer port, while the test server keeps its folder and DB and takes requests', async () => {
      const server = await start_test_server(undefined, undefined, undefined, undefined, undefined, SHORT_WAIT, register);
      try {
        const listening = listening_servers();
        holding = true;
        await expect(start_peer_server(server)).rejects.toThrow(TIMED_OUT);
        expect(await settled_listening(listening)).toBeLessThanOrEqual(listening);
        expect(server.peers.size).toBe(0);
        expect(existsSync(server.shared.folder)).toBe(true);
        expect(error_code(await resync(await login(server, 'after_peer_timeout')))).toBe(0);
      } finally {
        await stop_test_server(server);
      }
    });
  });

  // `push` is not in this core yet.
  it.skipIf(missing('push'))('a scheduled push is sent once after advance_time past its send_at and wait_background', async () => {
    // Noon UTC: not night time for a device at UTC.
    const start = 1_767_268_800_000n;
    const server = await start_test_server(start);
    try {
      const session = await login(server, 'push_target');
      const register = new CoreContract.RegisterPushTokenRequest();
      register.device_token = 'fake:testing_device';
      register.language = 'en';
      register.timezone_offset_ms = 0n;
      const registered = await send(session, 'core/RegisterPushToken', register, undefined, undefined, undefined, { 'X-Ogw-Platform': 'android' });
      expect(error_code(registered)).toBe(0);
      const send_at = start + 60_000n;
      const scheduled = await send_admin(server, 'schedule_push', {
        operation_id: randomUUID(),
        message_id: load_data().dev.find_id_value('[testing_notice]'),
        args: [],
        send_at: send_at.toString(),
        target: { user_ids: [session.user_id.toString()] },
      });
      expect(scheduled.status).toBe(200);
      const fcm = fake(server, 'push-fcm') as { calls(): readonly { readonly input: unknown }[] };
      expect(fcm.calls()).toHaveLength(0);
      const poll = BigInt(server.settings()['push.pollIntervalMs'] as number);
      advance_time(server, 60_000n + poll);
      await wait_background(server);
      expect(fcm.calls()).toHaveLength(1);
      advance_time(server, poll);
      await wait_background(server);
      expect(fcm.calls()).toHaveLength(1);
    } finally {
      await stop_test_server(server);
    }
  });
});
