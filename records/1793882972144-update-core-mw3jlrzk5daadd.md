# update core: routing

## done

- module `routing` (server), commit 0adae0c
  - `server/core/routing/http.ts`: the client IP takes the values of every `X-Forwarded-For` header line, in order, split at `,` and trimmed, with empty parts left out (`pipeline.ts` passes `req.headersDistinct`). A value that `net.isIP` does not accept gives the TCP peer address. An IPv4 address stays as written. An IPv4-mapped IPv6 address in any text form becomes the dotted decimal of its last 32 bits. Any other IPv6 address is written in RFC 5952 Section 4 form, with no dotted part and no zone index (`ip_text`). The TCP peer address is written the same way
  - `settings/core-settings.schema.json`: `routing.bodyReadTimeoutMs` minimum 1
  - Already matched the current spec, so no code change: step 13 handles a `FAILED` from `storage` whatever the function returned or threw, without an unhandled exception log (`finish`); the route handler throw gives HTTP 500 with no body and no CORS header, and an upgrade closes the connection; the route `request` line has `request`, `user_id`, `request_id`, `client_version`, `platform` and `seed` set to `null`, no `request_body`, and `error_code` 0 or `INTERNAL`; `storage_sweep` writes an `error` log holding the thrown error when `run_user_changes` throws (`storage_sweep: run_user_changes threw`, with the stack trace in `stack_trace`)
  - core tests added:
    - `parsing.test.ts`: IPv4-mapped forms, RFC 5952 output, header lines and trimming, values that are not IPs
    - `dev-and-network.test.ts`: STG with `trustedProxyCount` 1. `adminAllowedCidrs` `203.0.113.0/24` accepts `::ffff:203.0.113.5`, `::FFFF:203.0.113.5` and `::ffff:cb00:7105`; the truncated IP `203.0.113.0` appears in the audit and security lines; IPv6 texts of one address count in one `ip` row of `routing_rate_counter`; `::cb00:7105` and `fe80::1`; two header lines; values that fall back to the peer address
    - `processing-order.test.ts`: step 13 `FAILED` after the handler throws, returns a response or returns a `GameError`
    - `route-log.test.ts`: the `request` lines of admin requests and of an update-file 404
    - `storage-sweep.test.ts`: a throw of `run_user_changes`
    - `settings-minimum.test.ts`: the schema minimum of `routing.bodyReadTimeoutMs`
- Last runs: `ogw core test server routing testing` passed on sqlite and postgresql; `ogw code check core` passed (type check, lint, dependency, secret)
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written
- Review debt `records/review-debt/routing.json` D1 (host secret store read has no test) is not reached by these spec changes, so it was left as it is

## spec proposals

none

## review

none

## unverified

- Step 13 `FAILED` after a throw was tested by replacing `storage.run_request_transaction` with a wrapper that runs the function and then returns `FAILED`. A real PostgreSQL abort inside a handler was not run from routing; that path belongs to the `storage` tests
- The `storage_sweep` throw test uses a stub `storage` that throws; the real `run_user_changes` throw for left-out rows is being changed in a parallel `storage` job
