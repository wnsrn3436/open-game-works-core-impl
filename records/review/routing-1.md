# review routing round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The changed tests (`server/core/routing/tests/parsing.test.ts`, `dev-and-network.test.ts`, `processing-order.test.ts`, `route-log.test.ts`, `storage-sweep.test.ts`, `settings-minimum.test.ts`) were run only with `OGW_DEFAULT_DB` `sqlite` (91 passed). The `postgresql` run was not made: no PostgreSQL was given to this review.
- `ip_text` (`server/core/routing/http.ts:106`) was checked against `net.isIP` of Node v26.10.0 on the spec examples and on `::`, `1::`, `::1`, `1::2:3:4:5:6:7`, `0:0:1:0:0:0:1:0`, `1:2:3:4:5:6:1.2.3.4`, `64:ff9b::1.2.3.4`, `::ffff:0:0`, `::ffff:1.2.3.4%eth0`, `fe80::1%1.2.3.4`, `fe80::1%a:b` and values `net.isIP` rejects; every result was the RFC 5952 Section 4 form or the dotted IPv4 that `routing.md` sets. Other Node versions were not checked.
- `pipeline.ts:246` reads `req.headersDistinct`. Only the `node:http` server of `server/core/routing/server.ts` calls `Pipeline.handle` and `handle_upgrade` (no HTTP/2 server and no synthetic request object was found in `server/core`), so a request without `headersDistinct` was not looked for further.
- How `admin-api` matches the IPv6 client IP in RFC 5952 form against `adminAllowedCidrs`, and how `logging.truncate_ip` truncates it, belong to those modules and were not reviewed; only the IPv4-mapped cases of `dev-and-network.test.ts` were run.
- Test evidence of the new tests was judged by reading them against `pipeline.ts`, `http.ts` and `routing_module.ts`; no defect was restored in a temporary copy (round 1 has no `test evidence` finding to settle). Passing the two `X-Forwarded-For` header lines through `req.headers` (joined with `, ` by Node) would give the same client IP as `headersDistinct`, so that test cannot tell the two apart; both are the behavior `routing.md` sets, so it is not a finding.
