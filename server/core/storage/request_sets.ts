/** Request sets that more than one module checks request names against (`server-core` `## request`). */

/** `NoAccessTokenRpc`: received without an access token. */
export const NO_ACCESS_TOKEN_RPC: ReadonlySet<string> = new Set(['core/Login', 'core/AutoLogin', 'core/RefreshToken', 'core/GetTerms', 'core/GetNotices', 'core/cheat/DevLogin']);
