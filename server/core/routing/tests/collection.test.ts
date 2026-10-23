import { readdirSync, readFileSync } from 'node:fs';
import * as CoreContract from '../../../generated/contract/core_contract.ts';
import { collect_exports } from '../collect.ts';
import type { ModuleObject } from '../module_api.ts';
import { module_settings, preparation_order } from '../server.ts';
import { ENV_GAME_SETTINGS, MODULE_DEPENDENCIES } from '../spec_tables.ts';

const route = (): { status: number } => ({ status: 200 });

function collect(modules: Record<string, ModuleObject>, matchmaker = false): ReturnType<typeof collect_exports> {
  return collect_exports({ modules: new Map(Object.entries(modules)), matchmaker, core_rpcs: CoreContract.RPCS });
}

describe('collection of module exports', () => {
  it('fails server start when two modules export the same route', () => {
    const result = collect({
      'game-update': { 'GET /update/deploy_list.json': route, 'GET /update/deploy_list.json.sig': route, 'GET /update/files/<sha256>': route, get_deploy_list: {}, get_update_signing_key: {}, put_update_file: {}, publish_deploy_list: {}, prune_update_files: {} },
      'notice': { 'GET /update/deploy_list.json': route },
    });
    expect(result.errors.some((e) => e.includes('the same route GET /update/deploy_list.json'))).toBe(true);
  });

  it('fails server start when two modules export the same core rpc, or a module lacks the handler of its core rpc', () => {
    const doubled = collect({ session: { Resync: () => null }, logging: { Resync: () => null, ReportClientErrors: () => null, ReportAnalyticsEvents: () => null, list_client_errors: {}, list_client_events: {}, list_server_events: {} } });
    expect(doubled.errors.some((e) => e.includes('core/Resync'))).toBe(true);
    const missing = collect({ session: {} });
    expect(missing.errors).toEqual(['session has no handler of its core rpc core/Resync']);
  });

  it('collects only the operations whose caller is operator as admin operations', () => {
    const withdraw_user = { name: 'withdraw_user', role: 'ops' };
    const find_user_by_social_account = { name: 'find_user_by_social_account', role: 'read' };
    const auth: ModuleObject = {
      Login: () => null, AutoLogin: () => null, RefreshToken: () => null, Logout: () => null, LinkAccount: () => null,
      Withdraw: () => null, IssueDeletionCode: () => null, GetTerms: () => null, ConfirmAge: () => null, UpdateConsent: () => null, UpdatePushConsent: () => null,
      'GET /account/deletion': route, 'POST /account/deletion': route,
      // internal operations (caller routing or admin-api) are not admin operations
      verify_access_token: () => null, prepare_link_account: () => null,
      withdraw_user, find_user_by_social_account,
    };
    const result = collect({ auth });
    expect(result.errors).toEqual([]);
    expect(result.admin_operations).toEqual([
      { module: 'auth', operation: withdraw_user },
      { module: 'auth', operation: find_user_by_social_account },
    ]);
    expect(result.prepare.has('core/LinkAccount')).toBe(true);
    expect([...result.core_rpcs.keys()].sort()).toEqual(['core/AutoLogin', 'core/ConfirmAge', 'core/GetTerms', 'core/IssueDeletionCode', 'core/LinkAccount', 'core/Login', 'core/Logout', 'core/RefreshToken', 'core/UpdateConsent', 'core/UpdatePushConsent', 'core/Withdraw']);
    expect(result.routes.map((r) => r.key).sort()).toEqual(['GET /account/deletion', 'POST /account/deletion']);
  });

  it('keeps the request start table order and opens GET /realtime only with --matchmaker', () => {
    const called: string[] = [];
    const on = (name: string): ModuleObject => ({
      on_request_start: () => {
        called.push(name);
        return null;
      },
    });
    // given in the reverse of the table order, so the order comes from the table and not from the modules
    const modules = { 'public-profile': { ...on('public-profile'), GetPublicProfiles: () => null }, 'mailbox': { ...on('mailbox'), ReadMail: () => null, ClaimMail: () => null, ClaimAllMail: () => null }, 'live-event': { ...on('live-event') } };
    const request_start = collect(modules).request_start;
    expect(request_start).toHaveLength(3);
    for (const operation of request_start) operation(1n);
    expect(called).toEqual(['live-event', 'mailbox', 'public-profile']);
    const matchmaker: ModuleObject = { 'GET /realtime': route, ReportMatchResult: () => null };
    expect(collect({ matchmaker }, false).routes).toHaveLength(0);
    expect(collect({ matchmaker }, true).routes.map((r) => r.key)).toEqual(['GET /realtime']);
  });
});

describe('module preparation', () => {
  it('prepares each module after its dependencies, and after an optional dependency when that makes no cycle', () => {
    const order = preparation_order(['routing', 'validation', 'auth', 'session', 'storage', 'idempotency', 'server-time', 'logging', 'admin-api', 'game-update', 'item-ledger', 'mailbox', 'matchmaker', 'rating', 'ranking', 'p2p-signaling', 'live-event']);
    for (const [index, module] of order.entries()) {
      for (const dep of MODULE_DEPENDENCIES[module]?.dependencies ?? []) expect(order.indexOf(dep)).toBeLessThan(index);
    }
    expect(order.indexOf('ranking')).toBeLessThan(order.indexOf('admin-api'));
    expect(order.indexOf('matchmaker')).toBeLessThan(order.indexOf('rating'));
  });

  it('gives every module the settings object with this environment under environments.<ENV>', () => {
    const settings = module_settings('DEV', { 'routing.maxBodyBytes': 10 }, { 'environments.DEV.trustedProxyCount': 2, 'environments.PROD.trustedProxyCount': 1 }, { 'routing.maxBodyBytes': 20 });
    expect(settings['routing.maxBodyBytes']).toBe(20);
    expect(settings['environments.<ENV>.trustedProxyCount']).toBe(2);
  });

  it('gives a LOCAL server the LOCAL adapters and the empty value of the other environment items, and takes overrides', () => {
    const game = { 'environments.DEV.adapters': {}, 'environments.PROD.adapters': { cdn: 'cdn-r2' }, 'environments.PROD.adapters.login-google': 'login-google', 'environments.PROD.adminAllowedCidrs': ['10.0.0.0/8'] };
    const local = module_settings('LOCAL', {}, game, null);
    expect(local['environments.<ENV>.adapters']).toEqual({ cdn: 'fake', 'login-google': 'fake' });
    expect(local['environments.<ENV>.adapters.cdn']).toBe('fake');
    expect(local['environments.<ENV>.adapters.push-fcm']).toBeNull();
    expect(local['environments.<ENV>.adminAllowedCidrs']).toBeNull();
    expect(local['environments.<ENV>.corsAllowedOrigins']).toEqual([]);
    expect(local['environments.<ENV>.trustedProxyCount']).toBe(0);
    const overridden = module_settings('LOCAL', {}, game, { 'environments.<ENV>.adapters': { 'login-google': 'login-google' }, 'environments.<ENV>.serverUrl': 'http://x' });
    expect(overridden['environments.<ENV>.adapters.login-google']).toBe('login-google');
    expect(overridden['environments.<ENV>.adapters.cdn']).toBeNull();
    expect(overridden['environments.<ENV>.serverUrl']).toBe('http://x');
    expect(module_settings('STG', {}, { 'environments.STG.trustedProxyCount': 1 }, { 'environments.STG.trustedProxyCount': 2 })['environments.<ENV>.trustedProxyCount']).toBe(2);
  });

  it('knows the type of every environment game settings item of the core spec files', () => {
    const dir = new URL('../../../../core-spec/', import.meta.url);
    const types: Record<string, string> = {};
    for (const file of readdirSync(dir)) {
      const spec = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as { side: string; settings: { key: string; type: string; source: string }[] };
      if (spec.side !== 'server') continue;
      for (const row of spec.settings) if (row.source === 'game' && row.key.startsWith('environments.<ENV>.')) types[row.key.slice('environments.<ENV>.'.length)] = row.type;
    }
    expect(ENV_GAME_SETTINGS).toEqual(types);
  });

  it('uses the dependencies of the core spec files', () => {
    const dir = new URL('../../../../core-spec/', import.meta.url);
    const server: Record<string, { dependencies: string[]; optional: string[]; dev: string[] }> = {};
    for (const file of readdirSync(dir)) {
      const spec = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as { name: string; side: string; dependencies: string[]; optionalDependencies: string[]; devDependencies: string[] };
      if (spec.side === 'server') server[spec.name] = { dependencies: spec.dependencies, optional: spec.optionalDependencies, dev: spec.devDependencies };
    }
    expect(MODULE_DEPENDENCIES).toEqual(server);
  });
});
