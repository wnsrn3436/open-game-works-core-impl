/**
 * Values routing takes from the server core specs: the module dependencies (`## dependency`), the request
 * start and request prepare tables, the request sets of `server-core` `## request`, and the admin operations of
 * each module (`admin-api`'s table of collected operations).
 */

export interface ModuleDependencies {
  dependencies: readonly string[];
  optional: readonly string[];
  dev: readonly string[];
}

/** `## dependency` of every server module. A core test checks it against the core spec files. */
export const MODULE_DEPENDENCIES: Readonly<Record<string, ModuleDependencies>> = {
  'admin-api': { dependencies: ['storage', 'server-time', 'logging', 'item-ledger', 'mailbox'], optional: ['iap', 'ranking'], dev: [] },
  'ads-reward': { dependencies: ['item-ledger', 'mailbox', 'storage', 'idempotency', 'server-time', 'logging'], optional: [], dev: [] },
  'attendance': { dependencies: ['item-ledger', 'mailbox', 'live-event', 'validation', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'auth': { dependencies: ['session', 'storage', 'server-time', 'logging', 'admin-api', 'mailbox'], optional: ['live-event', 'public-profile', 'remote-config', 'ranking', 'push', 'iap', 'friend', 'guild', 'chat', 'block-report'], dev: [] },
  'block-report': { dependencies: ['storage', 'server-time', 'logging', 'validation', 'public-profile'], optional: [], dev: [] },
  'chat': { dependencies: ['storage', 'server-time', 'logging', 'validation', 'nickname', 'public-profile', 'block-report'], optional: ['friend', 'guild'], dev: [] },
  'cheat': { dependencies: ['storage', 'server-time'], optional: [], dev: [] },
  'coupon': { dependencies: ['item-ledger', 'mailbox', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'friend': { dependencies: ['storage', 'server-time', 'logging', 'nickname', 'public-profile', 'block-report'], optional: [], dev: [] },
  'gacha': { dependencies: ['loot-table', 'item-ledger', 'mailbox', 'live-event', 'storage', 'server-time', 'logging', 'validation'], optional: [], dev: [] },
  'game-update': { dependencies: ['validation', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'guild': { dependencies: ['storage', 'server-time', 'logging', 'validation', 'public-profile'], optional: [], dev: [] },
  'iap': { dependencies: ['item-ledger', 'mailbox', 'live-event', 'offer', 'validation', 'storage', 'idempotency', 'server-time', 'logging'], optional: [], dev: [] },
  'idempotency': { dependencies: ['storage', 'server-time'], optional: [], dev: [] },
  'item-ledger': { dependencies: ['storage', 'server-time', 'logging'], optional: [], dev: [] },
  'live-event': { dependencies: ['storage', 'server-time', 'logging'], optional: [], dev: [] },
  'logging': { dependencies: ['storage', 'server-time'], optional: [], dev: [] },
  'loot-table': { dependencies: ['storage', 'item-ledger', 'logging'], optional: [], dev: [] },
  'mailbox': { dependencies: ['item-ledger', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'matchmaker': { dependencies: ['auth', 'session', 'admin-api', 'storage', 'server-time', 'logging', 'p2p-signaling', 'validation', 'game-update'], optional: ['block-report', 'rating'], dev: [] },
  'migration': { dependencies: ['storage', 'server-time', 'logging'], optional: [], dev: ['user-snapshot-clone'] },
  'mission': { dependencies: ['item-ledger', 'mailbox', 'live-event', 'validation', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'nickname': { dependencies: ['item-ledger', 'validation', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'notice': { dependencies: ['admin-api', 'validation', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'offer': { dependencies: ['validation', 'live-event', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'p2p-signaling': { dependencies: ['server-time', 'logging'], optional: [], dev: [] },
  'play-session': { dependencies: ['storage', 'server-time', 'logging', 'validation', 'item-ledger'], optional: [], dev: [] },
  'public-profile': { dependencies: ['storage', 'nickname', 'logging', 'server-time'], optional: [], dev: [] },
  'push': { dependencies: ['session', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'ranking': { dependencies: ['mailbox', 'item-ledger', 'storage', 'server-time', 'logging', 'live-event'], optional: ['guild', 'nickname'], dev: [] },
  'rating': { dependencies: ['storage', 'ranking', 'mailbox', 'validation', 'logging', 'matchmaker'], optional: [], dev: [] },
  'remote-config': { dependencies: ['storage', 'server-time', 'logging'], optional: [], dev: [] },
  'reset-counter': { dependencies: ['storage', 'server-time'], optional: [], dev: [] },
  'routing': { dependencies: ['validation', 'auth', 'session', 'storage', 'idempotency', 'server-time', 'logging', 'admin-api', 'game-update', 'item-ledger', 'mailbox'], optional: ['live-event', 'shop', 'iap', 'ads-reward', 'ranking', 'tutorial', 'push', 'matchmaker', 'migration', 'user-snapshot-clone', 'gacha', 'loot-table', 'mission', 'attendance', 'coupon', 'notice', 'remote-config', 'nickname', 'public-profile', 'friend', 'block-report', 'guild', 'chat', 'play-session', 'reset-counter', 'rating'], dev: ['cheat'] },
  'server-time': { dependencies: [], optional: [], dev: [] },
  'session': { dependencies: ['storage', 'server-time'], optional: [], dev: [] },
  'shop': { dependencies: ['item-ledger', 'mailbox', 'live-event', 'offer', 'validation', 'storage', 'server-time', 'logging'], optional: [], dev: [] },
  'storage': { dependencies: ['server-time'], optional: [], dev: [] },
  'testing': { dependencies: ['routing', 'auth', 'session', 'storage', 'server-time', 'logging', 'cheat', 'item-ledger', 'game-update'], optional: ['iap', 'ranking', 'tutorial', 'push', 'matchmaker', 'p2p-signaling', 'migration', 'attendance', 'offer', 'ads-reward', 'rating'], dev: [] },
  'tutorial': { dependencies: ['storage', 'logging'], optional: [], dev: [] },
  'user-snapshot-clone': { dependencies: ['validation', 'storage', 'session', 'server-time', 'logging'], optional: [], dev: [] },
  'validation': { dependencies: ['storage', 'item-ledger'], optional: [], dev: [] },
};

/** Modules whose whole code is DEV code: their entry file is `dev/index.ts`. */
export const DEV_ONLY_MODULES: ReadonlySet<string> = new Set(['cheat', 'testing']);

/** The request start table: `on_request_start` of these modules, in this order. */
export const REQUEST_START_ORDER: readonly string[] = ['live-event', 'mailbox', 'public-profile'];

/** The request prepare table: core `rpc` name to (module, prepare operation). */
export const REQUEST_PREPARE: ReadonlyMap<string, { module: string; operation: string }> = new Map([
  ['core/ClaimAdReward', { module: 'ads-reward', operation: 'wait_ad_reward' }],
  ['core/RedeemCoupon', { module: 'coupon', operation: 'count_redeem_attempt' }],
  ['core/FindUserByPublicCode', { module: 'public-profile', operation: 'count_find_attempt' }],
  ['core/LinkAccount', { module: 'auth', operation: 'prepare_link_account' }],
  ['core/VerifyPurchase', { module: 'iap', operation: 'prepare_verify_purchase' }],
  ['core/RecoverPurchase', { module: 'iap', operation: 'prepare_verify_purchase' }],
  ['core/SyncSubscriptions', { module: 'iap', operation: 'prepare_sync_subscriptions' }],
]);

/** `NoAccessTokenRpc`: received without an access token. */
export { NO_ACCESS_TOKEN_RPC } from '../storage/index.ts';

/** `NoUserRpc`: handled without `auth` and without a user. */
export const NO_USER_RPC: ReadonlySet<string> = new Set(['core/GetNotices']);

/** Requests that pass step 7 when only the data hash differs. */
export const DATA_HASH_EXEMPT_RPC: ReadonlySet<string> = new Set(['core/FinishPlaySession', 'core/ContinuePlaySession', 'core/ReportMatchResult']);

/** Requests whose withdrawn response step 5 looks for first. */
export const WITHDRAWN_RESPONSE_RPC: ReadonlySet<string> = new Set(['core/Withdraw', 'core/ConfirmAge']);

/** Requests counted by `logging.count_report_request` instead of the user counter. */
export const REPORT_RPC: ReadonlySet<string> = new Set(['core/ReportClientErrors', 'core/ReportAnalyticsEvents']);

/** The request that passes step 6 for a banned user. */
export const BAN_EXEMPT_RPC = 'core/IssueDeletionCode';

/** Admin operations other modules export (`admin-api`'s collected operations; `caller` `operator`). */
export const MODULE_ADMIN_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  'auth': ['withdraw_user', 'find_user_by_social_account', 'find_user_by_public_code'],
  'block-report': ['list_reports', 'resolve_report'],
  'chat': ['list_chat_messages', 'delete_chat_message', 'mute_chat_user', 'unmute_chat_user'],
  'coupon': ['create_coupon', 'get_coupon', 'list_coupon_codes', 'disable_coupon'],
  'gacha': ['list_gacha_history'],
  'game-update': ['put_update_file', 'publish_deploy_list', 'get_deploy_list', 'get_update_signing_key', 'prune_update_files'],
  'guild': ['get_guild', 'rename_guild', 'set_guild_description', 'set_guild_member_role', 'kick_guild_member', 'disband_guild', 'import_guild'],
  'iap': ['revoke_test_grant'],
  'logging': ['list_client_errors', 'list_client_events', 'list_server_events'],
  'migration': ['start_migration_batch', 'get_migration_batch', 'stop_migration_batch'],
  'nickname': ['rename_user', 'find_user_by_nickname'],
  'notice': ['put_notice', 'delete_notice', 'list_notices'],
  'push': ['schedule_push', 'cancel_scheduled_push', 'get_push', 'list_pushes'],
  'remote-config': ['set_config_value', 'clear_config_value', 'put_experiment', 'stop_experiment', 'list_remote_config'],
  'user-snapshot-clone': ['export_user_snapshot', 'sample_user_ids', 'import_user_snapshot', 'list_clones', 'wipe_clone', 'export_game_state', 'sample_game_state', 'import_game_state'],
};

/** Core `rpc`s of each module's `## API` (`(core rpc`). The module object holds a method of the same name. */
export const MODULE_CORE_RPCS: Readonly<Record<string, readonly string[]>> = {
  'ads-reward': ['BeginAdReward', 'ClaimAdReward'],
  'attendance': ['ClaimAttendance'],
  'auth': ['Login', 'AutoLogin', 'RefreshToken', 'Logout', 'LinkAccount', 'Withdraw', 'IssueDeletionCode', 'GetTerms', 'ConfirmAge', 'UpdateConsent', 'UpdatePushConsent'],
  'block-report': ['BlockUser', 'UnblockUser', 'GetBlockedUsers', 'ReportUser'],
  'chat': ['SendChatMessage', 'GetChatMessages', 'ReportChatMessage', 'GetChatChannels', 'DeleteGuildChatMessage'],
  'coupon': ['RedeemCoupon'],
  'friend': ['SendFriendRequest', 'AcceptFriendRequest', 'DeclineFriendRequest', 'CancelFriendRequest', 'RemoveFriend', 'GetFriends', 'SearchUsers'],
  'gacha': ['DrawGacha', 'GetGachaRates', 'ListGachaHistory'],
  'guild': ['CreateGuild', 'UpdateGuild', 'GetGuild', 'GetMyGuild', 'SearchGuilds', 'ListJoinableGuilds', 'JoinGuild', 'CancelGuildJoinRequest', 'AcceptGuildJoinRequest', 'RejectGuildJoinRequest', 'LeaveGuild', 'KickGuildMember', 'SetGuildMemberRole'],
  'iap': ['CheckPurchase', 'VerifyPurchase', 'RecoverPurchase', 'SyncSubscriptions', 'ClaimIapDaily'],
  'logging': ['ReportClientErrors', 'ReportAnalyticsEvents'],
  'loot-table': ['GetLootRates'],
  'mailbox': ['ReadMail', 'ClaimMail', 'ClaimAllMail'],
  'matchmaker': ['ReportMatchResult'],
  'mission': ['ClaimMission'],
  'nickname': ['SetNickname'],
  'notice': ['GetNotices'],
  'play-session': ['StartPlaySession', 'ContinuePlaySession', 'FinishPlaySession'],
  'public-profile': ['GetPublicProfiles', 'FindUserByPublicCode'],
  'push': ['RegisterPushToken'],
  'ranking': ['GetRankingTop', 'GetRankingAround'],
  'rating': ['RefreshRating'],
  'remote-config': ['GetRemoteConfig'],
  'session': ['Resync'],
  'shop': ['BuyShopProduct'],
  'tutorial': ['SaveTutorialProgress'],
};

/** Routes of each module's `## API` (`(route`), as the spec writes them. `<name>` is one path segment. */
export const MODULE_ROUTES: Readonly<Record<string, readonly string[]>> = {
  'admin-api': ['POST /admin/<operation>'],
  'ads-reward': ['GET /ads/callback/<network>'],
  'auth': ['GET /account/deletion', 'POST /account/deletion'],
  'game-update': ['GET /update/deploy_list.json', 'GET /update/deploy_list.json.sig', 'GET /update/files/<sha256>'],
  'iap': ['POST /iap/notify/<store>'],
  'matchmaker': ['GET /realtime'],
};

/** Routes that only a `--matchmaker` server instance opens. */
export const MATCHMAKER_ROUTES: ReadonlySet<string> = new Set(['GET /realtime']);

/** The update routes of `### CORS`. */
export const UPDATE_ROUTES: ReadonlySet<string> = new Set(['GET /update/deploy_list.json', 'GET /update/deploy_list.json.sig', 'GET /update/files/<sha256>']);

/** Core cheats of each module's `## DEV` (`(core cheat)`), held by its DEV object; `cheat`'s come from `list_cheat_handlers`. */
export const MODULE_CORE_CHEATS: Readonly<Record<string, readonly string[]>> = {
  'ads-reward': ['FakeAdCallback'],
  'auth': ['DevLogin'],
  'item-ledger': ['SetItemBalance'],
  'mission': ['SetMissionProgress'],
  'reset-counter': ['SetResetCounter'],
};

/** DEV operations of `routing`'s `dev` that take ctx (the first input of their `## DEV` row is ctx). */
export const CTX_DEV_OPERATIONS: ReadonlySet<string> = new Set([
  'item-ledger.set_balance',
  'tutorial.set_tutorial_step',
  'attendance.set_attendance',
  'offer.set_offer',
  'ranking.close_season_now',
  'rating.set_rating',
]);

/**
 * Operations content calls only in `register` to register a hook by key (`core` `## hook`), as `<module>.<operation>`.
 * A call from `registerDev` is a call outside `register` and stops server start.
 */
export const CONTENT_REGISTER_OPERATIONS: readonly string[] = ['validation.register_requirement_judge', 'migration.register_converter', 'storage.register_user_change'];

/** DEV operations `dev` takes only between `create_server` and `start()`. */
export const BEFORE_START_DEV_OPERATIONS: ReadonlySet<string> = new Set(['server-time.set_clock', 'storage.set_seed_provider']);

/**
 * The type of every game settings item with `<ENV>` that a server module spec reads (`## settings`), by its path after
 * `environments.<ENV>.`. A LOCAL server instance has no game settings environment: these items take the LOCAL
 * value of `server-core` `## module`. A core test checks the table against the core spec files.
 */
export const ENV_GAME_SETTINGS: Readonly<Record<string, string>> = {
  'adUnits': 'object',
  'adapters': 'object',
  'adapters.ads': 'string?',
  'adapters.analytics': 'string?',
  'adapters.cdn': 'string?',
  'adapters.iap-apple': 'string?',
  'adapters.iap-google': 'string?',
  'adapters.login-apple': 'string?',
  'adapters.login-google': 'string?',
  'adapters.push-apns': 'string?',
  'adapters.push-fcm': 'string?',
  'adapters.turn': 'string?',
  'adminAllowedCidrs': 'array<string>?',
  'adminOperators': 'array<object>',
  'analyticsGa4.measurementId': 'string',
  'analyticsGa4.propertyId': 'string',
  'analyticsGa4.serviceAccountEmail': 'string',
  'cdnR2': 'object',
  'corsAllowedOrigins': 'array<string>',
  'devAllowedCidrs': 'array<string>?',
  'fcm.projectId': 'string',
  'fcm.serviceAccountEmail': 'string',
  'secrets.accessTokenKey': 'string',
  'secrets.analytics': 'string',
  'secrets.analyticsServiceAccount': 'string',
  'secrets.cdn': 'string',
  'secrets.db': 'string',
  'secrets.devAccess': 'string?',
  'secrets.iapAccountToken': 'string',
  'secrets.iapApple': 'string',
  'secrets.iapGoogle': 'string',
  'secrets.loginApple': 'string',
  'secrets.loginGoogleDesktop': 'string',
  'secrets.pushApns': 'string',
  'secrets.pushFcm': 'string',
  'secrets.turn': 'string',
  'secrets.updateSigningKey': 'string',
  'serverUrl': 'string',
  'trustedProxyCount': 'integer',
  'turnCoturn.urls': 'array<string>',
  'updatePublicKeys': 'array<string>',
};
