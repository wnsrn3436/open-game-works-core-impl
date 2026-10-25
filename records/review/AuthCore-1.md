# review AuthCore round 1

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

- The range 2ef5ae8..4d3efc4 changes AuthCore only for the public code: `AuthSession.public_code` (`client/godot/core/auth_core/auth_session.gd:15`), `LoginResult.public_code` (`client/godot/core/auth_core/login_result.gd:10`), filling them in `_open_session` (`client/godot/core/auth_core/auth_core.gd:721`, `:737`), `_login_failure` (`:759`, `:765`) and `switch_account` (`:1543`), the new `get_public_code` (`:803-811`), `core-spec/AuthCore.json:482` and the tests in `client/godot/core/auth_core/tests/test_login.gd:272-311` and `client/godot/core/auth_core/tests/test_account.gd:100-101`. Each was compared with the AuthCore spec lines 45, 62, 116, 121-123, 284, 399 and 413. Auto login (`auth_core.gd:448`), `login` (`:710`) and `AuthCoreDev.dev_login` (`client/godot/core/auth_core/dev/auth_core_dev.gd:36`) all go through `_open_session`, so the `Success` public code comes from the response `AuthResult` on every path that spec line 122 lists. `dev_login` also takes `BANNED` through `_login_failure` (`auth_core_dev.gd:31`). That ban-session behavior existed before the range and did not change
- On the server side, only the places that fill the fields AuthCore reads were checked. `AuthResult.public_code` is filled at `server/core/auth/login.ts:225`, the ban-login `BanDetail.public_code` at `server/core/auth/login.ts:125` and `:136`, and the routing step-6 `BanDetail.public_code` at `server/core/routing/pipeline.ts:588`. The rest of the server `auth`, `storage`, `public-profile` and `routing` changes in the range was not reviewed, because those belong to their own modules' reviews
- BootstrapCore's use of `LoginResult.public_code` (`client/godot/core/bootstrap_core/bootstrap_core.gd:966-990`, `:1003-1012`) was compared only with BootstrapCore spec lines 94-95 and 193-195, and no problem was found. Its other changes, and the SoundCore and TweenCore changes in the range, were not reviewed, because they are outside AuthCore
- The AuthCore tests were not run. They run through `ogw core test` with its test host, and a review agent does not start that. Every finding decision above comes from reading the code
