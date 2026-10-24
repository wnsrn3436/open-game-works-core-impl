# open-game-works-core-impl

[한국어](README.ko.md)

The core of open-game-works: the Godot client core, the TypeScript server core, the base protobuf, and the contract and
data tools that every game made with the harness is built on.

https://github.com/user-attachments/assets/fb74b4ca-cc63-430d-af79-5b5118ec9c8a

<table>
  <tr>
    <td align="center" width="50%"><img src=".github/media/iso-survivors.gif" alt="iso-survivors gameplay"><br><a href="https://github.com/wnsrn3436/open-game-works-game-iso-survivors">iso-survivors</a>: isometric 3D horde survival</td>
    <td align="center" width="50%"><img src=".github/media/mana-clash.gif" alt="mana-clash gameplay"><br><a href="https://github.com/wnsrn3436/open-game-works-game-mana-clash">mana-clash</a>: one-on-one card battle</td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src=".github/media/pong.gif" alt="pong gameplay"><br><a href="https://github.com/wnsrn3436/open-game-works-game-pong">pong</a>: paddle game against the CPU</td>
    <td align="center" width="50%"><img src=".github/media/card-duel.gif" alt="card-duel gameplay" width="220"><br>card-duel: real-time card battle against an AI, made with a very early version of open-game-works (repository not published)</td>
  </tr>
</table>

## What it is

[open-game-works](https://github.com/wnsrn3436/open-game-works-core) is a harness in which AI agents make server-client
games. Features that many games would otherwise write again the same way are built once, in advance, as **core**.
Agents write only the gameplay, as **content code**, on top of it. Core holds only features outside the gameplay loop:

| area | examples |
|---|---|
| infra | server request handling and save, login, network and realtime connection, update, client UI, input, presentation tools, platform integration, development and test tools |
| live ops | maintenance, notice, kill switch, item grant and revocation, ban, coupon, live event, remote config, push, bundle patch |
| store policy | receipt verification and refund handling, consent to terms, age check, account deletion, probability disclosure, store privacy disclosure, tracking permission |
| meta system | item, shop, mailbox, mission, attendance, gacha, ranking, rating, friend, guild |

This repository is the implementation of that core. Agents develop it through the harness, it is released as GitHub
Releases of this repository, and each game pins one release with `coreVersion` in its `settings.json`.

| repository | contents |
|---|---|
| [open-game-works-core](https://github.com/wnsrn3436/open-game-works-core) | the harness: agent rules, skills, module specs, the CLI `ogw` |
| [open-game-works-core-impl](https://github.com/wnsrn3436/open-game-works-core-impl) | this repository: the core implementation. Core releases are its GitHub Releases |
| [open-game-works-game-mana-clash](https://github.com/wnsrn3436/open-game-works-game-mana-clash) | a game made with open-game-works |
| [open-game-works-game-pong](https://github.com/wnsrn3436/open-game-works-game-pong) | a game made with open-game-works |

## Status

open-game-works is under active development, and so is this core. So far core work has been tested only on macOS, with
Claude Code running Claude Opus 5.5 at high effort, and the `build` command has not been run yet; the
[harness README](https://github.com/wnsrn3436/open-game-works-core#status) has the details.

## How it works

```
open-game-works-core (harness)
  skills/client-core/modules/*.md       client module specs
  skills/server-core/modules/*.md       server module specs
        |
        |  ogw core spec                  -> core-spec/<module>.json
        |  core agents implement          -> client/godot/, server/core/, tools/
        |  ogw core test, ogw code check core, review agents
        v
open-game-works-core-impl (this repository, branch main)
        |
        |  ogw core release <version>     -> tag v<version>, GitHub Release with the assets
        v
open-game-works-core-releases/<version>/  local cache of fetched releases, checked by SHA-256
        |
        |  ogw generate
        v
games/<game>/                             settings.json "coreVersion": "<version>"
  client/core/                            <- core/ of client-godot.zip
  server/core/                            <- server.tgz
```

- **Spec first.** Every module has a spec in the harness that states its public API, behavior, hooks, events, errors,
  settings, data and tests, independent of the engine. The implementation changes only after the spec changes.
  `core-spec/` is the part of those specs that tools read. `ogw core spec` writes it; it is never edited by hand.
- **Core does not depend on content code.** Content code passes only hooks, callbacks and data to core. Hooks take over
  game-specific decisions (validation, handling, after hooks); events tell content code about things.
- **One version for everything.** Client core, server core, contract tool, data tool and core settings share one core
  version.
- **Core settings.** Defaults are in `settings/core-settings.json`, with keys of the form `<module name>.<camelCase>`
  (e.g. `NetworkCore.retryCount`). A game overrides them in the `core` object of its game settings.
- **Modules a game uses.** `BootstrapCore`, `routing`, `migration`, `user-snapshot-clone`, the modules in game settings
  `coreModules`, and every module those depend on.
- **Games do not edit core.** A game's `client/core/` and `server/core/` are copies of a core release, and the static
  check `core diff` compares them with the release. When core falls short, the content agent writes a core proposal in
  the game's `records/core-proposals/`, and a human orders it applied with `update core`.

## Repository layout

| path | contents |
|---|---|
| `client/godot/` | the Godot client core. The folder is itself a Godot project. `core/<module folder>/` holds one module each; `engine.json` pins the engine, test tools, plugins and platform build tools |
| `client/godot/plugins/ogw-native-ui/` | source and prebuilt `dist/` of the native plugin `ogw-native-ui` (Android, iOS, macOS) and its `build.sh` |
| `server/core/` | the TypeScript server core: one folder per module, plus `start.ts`, the server process entry point |
| `server/generated/`, `server/dev/generated/` | code generated from the core test data, used by server core tests |
| `proto/ogw/` | the base protobuf: `core.proto` and `options.proto` |
| `tools/contract-tool/` | the contract tool (npm package) |
| `tools/data-tool/` | the data tool (npm package) |
| `tools/tests/` | round-trip test inputs of the two tools: `game/` (a contract, data and game settings in the game repo structure) and `godot/` (the Godot round-trip tests) |
| `core-spec/` | one JSON file per module, generated by `ogw core spec` from the harness module specs. Never edited by hand |
| `settings/` | `core-settings.json` (core settings defaults) and `core-settings.schema.json` (its JSON schema) |
| `fixtures/` | core test fixtures: input and expected value files that client and server core tests both read |
| `test-data/` | core test data in the structure of a game repo: `contract/`, `data/`, `settings.json`, and the banned word list in `records/setup/banned-words/` |
| `benchmark/godot/` | a benchmark game in the structure of a game repo, shipped as the release asset `benchmark-godot.zip` |
| `licenses.json` | the license manifest of the third-party components that go into the client |

`core-spec/`, `client/godot/project.godot` and the `generated/` folders outside `benchmark/` are written by
`ogw core spec` and `ogw core test` (which runs the contract tool and the data tool on the core test data), and the
harness tool commits them.

### Client core (Godot)

- `client/godot/engine.json` pins the engine: Godot `4.7.2.stable`, GUT `9.7.1` for tests, the native plugins and the
  build tools per platform (JDK 17 and Android command-line tools for Android, Xcode for iOS and macOS, Jsign and a
  Temurin JRE for Windows).
- Core module code is GDScript only; native code comes in only as the plugins of `engine.json` `plugins`.
- A module is a static class declared as `class_name <Module>` in `core/<module folder>/<module folder>.gd`, where the
  folder is the snake_case module name (`UICore` -> `core/ui_core/`). A module folder can have `adapters/` (external
  service adapters), `dev/` (DEV code, left out of STG and PROD builds) and `tests/` (core tests, not released).
- `core/web/` holds the HTML shell and the service worker of the Web export.
- Core tests run with GUT through `UnitTestCore`, both natively and in a headless browser from a Web export.
- Native plugins in `engine.json` `plugins`: `webrtc-native` (the Godot WebRTC GDExtension, used by `RealtimeCore`) and
  `ogw-native-ui`, which core writes itself.

`ogw-native-ui` gives `NativeUiCore` the store review request window and the share window on Android (Godot Android
plugin v2, Gradle), iOS (a static library in an xcframework, Xcode project) and macOS (GDExtension, SCons). Its build
results are committed in `dist/<platform>/`. On a Mac host, `build.sh <work folder>` rebuilds them: it checks out the
Godot source and godot-cpp into the work folder once, and needs Xcode, SCons, JDK 17 (`JAVA_HOME`) and the Android SDK
(`ANDROID_HOME`). `ogw core release` packs `dist/` into the release asset `client-godot-plugins.zip` and writes its URL
and SHA-256 into `engine.json`.

### Server core (TypeScript)

- A module folder `server/core/<module>/` has `index.ts` (the entry file), `adapters/` (real, sandbox and clock
  adapters), `dev/` (DEV code, including fake adapters) and `tests/` (`<topic>.test.ts`). `cheat` and `testing` are
  DEV code as a whole.
- The DB is behind an adapter: SQLite locally, PostgreSQL in DEV, STG and PROD. Server core tests run with vitest on
  both SQLite and PostgreSQL.
- External services (e.g. store payment, ads, push, social login) are behind adapters: a fake, a sandbox and a real
  adapter per interface.
- Realtime starts as P2P (`matchmaker`, `p2p-signaling`). The realtime message contract and the transport are kept
  separate.
- User items are changed only through the `item-ledger` API.
- `server.tgz` of a release is `server/core/` without the `tests/` folders.

### Base protobuf and tools

- `proto/ogw/core.proto` (package `ogw.core`) holds the response envelope `ResponseEnvelope`, `ServerError` and
  `CoreError`, the UserState delta, `service Core` (core rpcs), `service CoreCheat` (core cheats) and the messages of
  the core modules.
- `proto/ogw/options.proto` (package `ogw`) holds the custom options that game contracts use: request options
  (`silent`, `retry`, `errors`, `sensitive`), `core_errors`, `public`, `converters` and the field validation rules `v`.
- The **contract tool** checks a game contract against the writing rules and backward compatibility, then generates
  client code and server code (and their DEV code) from it.
- The **data tool** reads, checks and builds game data CSV tables into data proto, generated code and binaries, issuing
  ID values through the game's ID registry.
- Each tool is one npm package. `npm run build` bundles it into `bin/<tool>.js` (not committed); its tests are
  `*.test.ts` under `tests/`, run with vitest. A release ships them as `contract-tool.tgz` and `data-tool.tgz`, each
  with the base proto under `proto/`.

## Modules

There are 43 client modules and 42 server modules. Each one has a spec in the harness:
[client module list](https://github.com/wnsrn3436/open-game-works-core/blob/main/skills/client-core/SKILL.md) and
[specs](https://github.com/wnsrn3436/open-game-works-core/tree/main/skills/client-core/modules),
[server module list](https://github.com/wnsrn3436/open-game-works-core/blob/main/skills/server-core/SKILL.md) and
[specs](https://github.com/wnsrn3436/open-game-works-core/tree/main/skills/server-core/modules).

Client modules (`client/godot/core/`):

| purpose | modules |
|---|---|
| foundation | `UtilCore`, `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `BootstrapCore` |
| resources, data and sound | `ResourceCore`, `PoolCore`, `DataCore`, `RequirementCore`, `LocalizationCore`, `SoundCore` |
| server, account and state | `NetworkCore`, `UserStateCore`, `AuthCore`, `GameUpdateCore`, `RemoteConfigCore`, `NoticeCore` |
| store, ads and push | `PaymentCore`, `AdCore`, `PushCore` |
| screen, input and presentation | `ResolutionCore`, `SafeAreaCore`, `InputCore`, `InputBlockCore`, `VirtualPadCore`, `CameraCore`, `ScreenEffectCore`, `TweenCore`, `QualityCore`, `AccessibilityCore` |
| UI and flow | `UICore`, `MessageCore`, `BadgeCore`, `ShortcutCore`, `SceneCore`, `CutsceneCore`, `TutorialCore`, `NativeUiCore` |
| realtime and chat | `RealtimeCore`, `ChatCore` |
| development and test (DEV code) | `QACore`, `UnitTestCore` |

Server modules (`server/core/`):

| purpose | modules |
|---|---|
| request handling, save and time | `routing`, `validation`, `session`, `storage`, `idempotency`, `server-time`, `logging`, `migration` |
| account and profile | `auth`, `nickname`, `public-profile` |
| live ops | `admin-api`, `notice`, `remote-config`, `push`, `coupon`, `live-event`, `game-update`, `user-snapshot-clone` |
| items and economy | `item-ledger`, `mailbox`, `shop`, `iap`, `offer`, `ads-reward`, `loot-table`, `gacha` |
| progress | `mission`, `attendance`, `reset-counter`, `tutorial`, `play-session` |
| competition and realtime | `ranking`, `rating`, `matchmaker`, `p2p-signaling` |
| social | `friend`, `guild`, `chat`, `block-report` |
| development and test (DEV code) | `cheat`, `testing` |

## Development through the harness

This repository is meant to be used inside the open-game-works workspace, next to the harness. Core agents make and
edit it; a human gives commands in a Claude Code or Codex session opened in `open-game-works-core/`.

| command | what it does |
|---|---|
| `update core: <proposal>` | Applies a core proposal file, or a human's request, and releases it as a new version |
| `create client core: <engine>` | Makes the client core of a new engine in `client/<engine>/` from the specs and releases it. Godot is the first engine; the harness lists Three.js, Phaser, Unity and Unreal as target engines |

What `update core` does:

1. The lead agent reads the proposal and edits the module specs in the harness. Each changed spec goes through a spec
   review.
2. Core agents implement the change, each in its own worktree `worktrees/_core/<id>/` on a branch `agent/<id>`.
   Before `ogw agent merge` merges a result into main, it checks that the agent's last `ogw core test` passed and that
   the result adds no new type check failure.
3. Review agents review each changed module and tool against its spec, together with `ogw code check core`, round by
   round until a round finds nothing open.
4. The lead agent decides the version and runs `ogw core release <version>`.
5. Each game moves to the new version in its own `update game`.

The `ogw` commands that work on this repository:

| command | what it does |
|---|---|
| `ogw core spec` | writes `core-spec/` from the module specs of the harness |
| `ogw core test server` | server core tests, on SQLite and PostgreSQL |
| `ogw core test godot` | Godot client core tests, native run |
| `ogw core test godot --web` | Godot client core tests in headless Chromium, from a Web export |
| `ogw core test tools` | contract tool and data tool tests |
| `ogw code check core` | static checks of the core code (type check, lint, dependency, secret) |
| `ogw core licenses` | fills the full license texts of `licenses.json` |
| `ogw core release <version>` | checks the release conditions, tags `v<version>` and publishes the GitHub Release |

`ogw core test` takes module names to run only some modules, e.g. `ogw core test server item-ledger`.

While core is being developed, harness settings `useLocalCore` can be set to `true`: the harness tool then uses this
folder instead of the release of a game's core version, and does not start loop iterations or builds.

## Versions and releases

The version format is `<major>.<minor>.<patch>`.

| part | raised for |
|---|---|
| major | a change that breaks compatibility of the public API, behavior, hooks, events, core settings keys, system table schema, base proto, the code the two tools generate, the CLI of the two tools, or the `core-spec.json` format |
| minor | an addition that keeps compatibility |
| patch | a bug fix that does not change the public API |

A release puts the tag `v<version>` on a main commit and publishes a GitHub Release with these assets:

| asset | contents |
|---|---|
| `client-godot.zip` | `core/` of the Godot client core without `tests/`, and `engine.json` |
| `client-godot-plugins.zip` | the build results of the `ogw-` native plugins |
| `benchmark-godot.zip` | the benchmark game. `update env` measures with it how many instances the host can run at once |
| `server.tgz` | `server/core/` without `tests/` |
| `contract-tool.tgz`, `data-tool.tgz` | the bundled tool and the base proto |
| `core-settings.json`, `core-settings.schema.json` | core settings defaults and schema |
| `core-settings-constraints.json` | the settings constraints of all modules |
| `core-spec.json` | the merged `core-spec/` |
| `licenses.json` | the license manifest |
| `manifest.json` | the version, the SHA-256 of every other asset, and the core schema version |

The assets of a published version never change; a fix is a new version. `ogw core release` publishes only when all of
these hold:

- every core test target passes on the main HEAD commit
- `core-spec/` matches the current harness specs
- every review is done and no must-fix review item remains
- `ogw code check core` passes
- the core settings defaults keep the settings constraints
- the native plugin builds exist for all target platforms
- a break of base proto compatibility with the previous release comes with a higher major version

A game names its version in `settings.json` `coreVersion`. The harness tool looks for that version in
`open-game-works-core-releases/` and, when it is not there, fetches it from the GitHub Release and checks the files by
hash. `ogw generate` copies the release into the game's `client/core/` and `server/core/`.

## Requirements

Everything the [harness](https://github.com/wnsrn3436/open-game-works-core) requires, including Node.js 24 or later,
Git, GitHub CLI logged in, Docker with buildx, uv and Python, and Claude Code and/or Codex CLI logged in. Core work also
needs:

- Godot at the version in `client/godot/engine.json`. `update env` installs it.
- The programs and image in harness settings `tools` that core tests and code checks use: the PostgreSQL image
  `tools.postgresql` (server core tests on PostgreSQL), headless Chromium `tools.chromium` (`--web` runs) and gdtoolkit
  `tools.gdtoolkit` (the GDScript linter `gdlint` that `ogw code check core` runs). `update core` checks them with
  `ogw env check --for update-core` before it starts.
- For publishing a release, a GitHub CLI login with push access to the release repository of harness settings
  `coreReleaseRepository` (`wnsrn3436/open-game-works-core-impl`).
- For rebuilding `ogw-native-ui`, a Mac with Xcode, SCons, JDK 17 and the Android SDK.

macOS is the primary host: iOS and macOS builds need Xcode. This repository has no symbolic links, but the harness and
the games do; on Windows, enable Developer Mode and set `git config --global core.symlinks true` before cloning them, or
the links check out as plain text files.

## Setup

Clone this repository next to the harness, in the workspace layout:

```
<workspace>/
  open-game-works-core/            harness (this is where you run Claude Code or Codex)
  open-game-works-core-impl/       this repository
  open-game-works-core-releases/   cache of downloaded core releases (created by the tool)
  games/<game>/                    one repository per game
  worktrees/                       created and removed by the tool
  .ogw/                            engines, build tools, local generation models (created by `update env`)
```

```sh
cd <workspace>
git clone https://github.com/wnsrn3436/open-game-works-core.git
git clone https://github.com/wnsrn3436/open-game-works-core-impl.git
```

The harness finds this folder through `paths.coreImpl` in `open-game-works-core/settings.json`. Then follow the
[quick start](https://github.com/wnsrn3436/open-game-works-core#quick-start) of the harness README: install the harness
tool's packages with `npm ci` in `open-game-works-core/tools`, store the Claude Code token with
`ogw secret set --harness claude-code-oauth-token`, and run `update env`.

## License

Apache License 2.0. See [LICENSE](LICENSE).

The third-party components that go into the client (the engine and its components, plugins and the SDKs in them, and third-party code ported into core code) are
listed in `licenses.json` with their SPDX license, source URL, required notice, platforms and the core modules that use
them; `texts` holds the full license texts. For each game, `ogw generate` writes the game's license manifest
`client/generated/licenses.json` from it. The `client/core/` and `server/core/` folders of a game are copies of a core
release and stay under Apache-2.0.

The benchmark game bundles the Noto Sans KR font as `benchmark/godot/resource/font/main.ttf`. The font stays under the
SIL Open Font License 1.1; its copyright notice and license text are in
`benchmark/godot/LICENSES/OFL-1.1-NotoSansKR.txt`, which ships with the font in `benchmark-godot.zip`.

The gameplay GIFs in `.github/media/` are not covered by the Apache License 2.0. They show games made with
open-game-works and are licensed under [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) (see `.github/media/LICENSE`).
