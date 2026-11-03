# review routing round 1

## findings

none

## previous

none

## out of scope

- server/core/routing/start_parts.ts:196: medium `test evidence`: reading a secret from the host secret store (files `/run/secrets/<secret name>`, content without one trailing newline, `server-core` `server-image.md`, field `read_secret` of `server-core` `## module`) has no test. `HOST_SECRET_DIR` and `secret_reader` appear only in `start_parts.ts` and `server.ts`, and no test holds `run/secrets`. A run without `--secret-file`, such as the `--env STG` runs of `server/core/routing/tests/server-image.test.ts`, mounts no secret, so that branch can only return `null` there, and neither a value read from a file nor the removal of its trailing newline is exercised. This code is not in the commit range

## debt

none

## must fix

none

## unknown

- The changes of this range in `server/core/coupon/`, `server/core/matchmaker/`, `server/core/testing/dev/setting_types.ts`, `core-spec/` of other modules and the client and tool folders were not reviewed, because they belong to other targets. For `core-spec/routing.json`, only the removal of `idempotency.responseRetentionMs` was checked: `routing.md` does not list that key and `server/core/routing/` does not read it
- Routing code outside the range was not audited, because the commit range limits findings to what the changes cause or reveal
- A server in an image was not run on `--env DEV`, `STG` or `PROD` against PostgreSQL with mounted secrets. The tests reach only the start failure on `--env STG` and a served request on `--env LOCAL` with SQLite
- Pushing an image, `--label ogw.compat_client_data_version` and the content of the real build context are done by the harness tool `tools/src/commands/build/lib/serverimage.ts`, which was read but is not this target and was not run. `COPY . /prepare` keeps every file of the context, so "contains no secrets" rests on that context holding none. This was not checked against a real game `server/`
- `ogw core test server routing` printed `routing pass` per module on `1db746e`, and it does not list single tests. The tests of `server-image.test.ts` and `storage-sweep.test.ts` were read, and their results were not seen one by one
- No defect was restored in a temporary copy to prove that the new tests fail on it, because this round has no finding that needs it. Their strength was judged by reading their asserts
- By hand, a temporary copy of `server/` was built with `--platform linux/amd64` and `OGW_ENV=STG` on an arm64 host. The result held an x86-64 `node`, no `dev/` or `tests/` path and no `core/Dockerfile`, and `core/cheat/` and `core/testing/` remained as empty folders, which `has_dev_code` of `server/core/start.ts` does not count. That image was not started
- The base image digest was checked to be a multi-platform index that lists `linux/amd64` by `docker buildx imagetools inspect`. Only the first entries of the output were read, and `linux/arm64` is inferred from the native builds that pass on this arm64 host
