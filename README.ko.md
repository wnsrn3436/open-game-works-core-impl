# open-game-works-core-impl

[English](README.md)

open-game-works의 코어다. 하네스로 만드는 모든 게임의 바탕이 되는 Godot 클라이언트 코어, TypeScript 서버 코어, 기본 protobuf, contract tool과 data tool을 담는다.

이것으로 만든 게임: [하네스 README](https://github.com/wnsrn3436/open-game-works-core/blob/main/README.ko.md)를 본다.

## 무엇인가

[open-game-works](https://github.com/wnsrn3436/open-game-works-core)에서는 여러 게임이 매번 같은 방식으로 다시 만들게 되는 기능을 **코어**(core)로 미리 한 번 만들어 둔다. 에이전트는 그 위에서 게임플레이만 **콘텐츠 코드**(content code)로 작성한다.

| 영역 | 예 |
|---|---|
| 인프라 | 서버 요청과 저장, 로그인, 네트워크와 실시간, 업데이트, UI, 입력, 플랫폼, 개발·테스트 도구 |
| 라이브 운영 | 점검, 공지, 킬 스위치, 아이템 지급, 제재, 쿠폰, 라이브 이벤트, 원격 설정, 푸시 |
| 스토어 정책 | 영수증과 환불, 약관, 연령 확인, 계정 삭제, 확률 공개, 추적 권한 |
| 메타 시스템 | 아이템, 상점, 우편함, 미션, 출석, 가챠, 랭킹, 레이팅, 친구, 길드 |

이 저장소는 그 코어의 구현이다. 하네스를 통해 개발하고 이 저장소의 GitHub Releases로 릴리스하며, 각 게임은 자기 `settings.json`의 `coreVersion`으로 릴리스 하나를 고정해서 쓴다.

## 상태

open-game-works의 나머지와 마찬가지로 한창 개발 중이다. 자세한 내용은 [하네스 README](https://github.com/wnsrn3436/open-game-works-core/blob/main/README.ko.md#현재-상태)에 있다.

## 작동 방식

```
open-game-works-core (하네스)           모듈 스펙: skills/{client,server}-core/modules/*.md
        |  ogw core spec, 코어 에이전트가 구현, ogw core test, 리뷰 에이전트
        v
open-game-works-core-impl (이 저장소)   client/godot/, server/core/, tools/, core-spec/
        |  ogw core release <version>   -> v<version> 태그, GitHub Release
        v
games/<game>/                           settings.json "coreVersion": "<version>"
        client/core/, server/core/      <- ogw generate가 릴리스에서 복사
```

- **스펙이 먼저다.** 하네스의 모듈 스펙이 먼저 바뀌고 구현은 그 뒤에 바뀐다. `core-spec/`은 스펙에서 생성한다.
- **코어는 콘텐츠 코드에 의존하지 않는다.** 콘텐츠 코드는 훅, 콜백, 데이터만 코어에 넘기고, 코어는 알릴 일을 이벤트로 전한다.
- **버전은 하나다.** 클라이언트 코어, 서버 코어, 두 도구, 코어 설정이 하나의 코어 버전을 함께 쓴다.
- **코어 설정.** 기본값은 [`settings/core-settings.json`](settings/core-settings.json)에 있고(예: `NetworkCore.retryCount`), 게임은 게임 설정의 `core` 객체에서 이 값을 덮어쓴다.
- **게임은 코어를 고치지 않는다.** 코어가 부족하면 콘텐츠 에이전트가 게임의 `records/core-proposals/`에 코어 제안을 쓰고, 사람이 `update core`로 적용을 지시한다.

## 폴더 구조

| 경로 | 내용 |
|---|---|
| `client/godot/` | Godot 클라이언트 코어(폴더 자체가 Godot 프로젝트). `core/<module folder>/`마다 모듈 하나 |
| `client/godot/plugins/` | 코어가 직접 작성하는 네이티브 플러그인(`ogw-native-ui`, `ogw-secure-storage`): 소스와 미리 빌드한 `dist/` |
| `server/core/` | TypeScript 서버 코어. 모듈마다 폴더 하나와 진입점 `start.ts` |
| `proto/ogw/` | 기본 protobuf: `core.proto`, `options.proto` |
| `tools/` | `contract-tool/`과 `data-tool/`(npm 패키지), 두 도구의 왕복 테스트 |
| `core-spec/` | 모듈마다 JSON 파일 하나. `ogw core spec`이 생성하며 사람이 고치지 않는다 |
| `settings/` | 코어 설정 기본값과 그 JSON 스키마 |
| `fixtures/`, `test-data/` | 코어 테스트 픽스처, 게임 저장소 구조로 된 코어 테스트 데이터 |
| `benchmark/godot/` | 벤치마크 게임. `benchmark-godot.zip`으로 릴리스한다 |
| `records/` | 이 저장소에서 실행한 하네스 명령의 실행 기록 |
| `licenses.json` | 클라이언트에 들어가는 서드파티 구성 요소의 라이선스 목록 |

[`client/godot/engine.json`](client/godot/engine.json)이 엔진(Godot `4.7.2.stable`), 테스트용 GUT, 네이티브 플러그인, 플랫폼별 빌드 도구를 고정한다.

## 모듈

클라이언트 모듈 43개, 서버 모듈 42개가 있고, 모듈마다 하네스에 스펙이 있다: [클라이언트 스펙](https://github.com/wnsrn3436/open-game-works-core/tree/main/skills/client-core/modules), [서버 스펙](https://github.com/wnsrn3436/open-game-works-core/tree/main/skills/server-core/modules).

| 클라이언트 (`client/godot/core/`) | 모듈 |
|---|---|
| 기반 | `UtilCore`, `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `BootstrapCore` |
| 리소스, 데이터, 사운드 | `ResourceCore`, `PoolCore`, `DataCore`, `RequirementCore`, `LocalizationCore`, `SoundCore` |
| 서버, 계정, 상태 | `NetworkCore`, `UserStateCore`, `AuthCore`, `GameUpdateCore`, `RemoteConfigCore`, `NoticeCore` |
| 스토어, 광고, 푸시 | `PaymentCore`, `AdCore`, `PushCore` |
| 화면, 입력, 연출 | `ResolutionCore`, `SafeAreaCore`, `InputCore`, `InputBlockCore`, `VirtualPadCore`, `CameraCore`, `ScreenEffectCore`, `TweenCore`, `QualityCore`, `AccessibilityCore` |
| UI와 흐름 | `UICore`, `MessageCore`, `BadgeCore`, `ShortcutCore`, `SceneCore`, `CutsceneCore`, `TutorialCore`, `NativeUiCore` |
| 실시간과 채팅 | `RealtimeCore`, `ChatCore` |
| 개발과 테스트 (DEV 코드) | `QACore`, `UnitTestCore` |

| 서버 (`server/core/`) | 모듈 |
|---|---|
| 요청 처리, 저장, 시간 | `routing`, `validation`, `session`, `storage`, `idempotency`, `server-time`, `logging`, `migration` |
| 계정과 프로필 | `auth`, `nickname`, `public-profile` |
| 라이브 운영 | `admin-api`, `notice`, `remote-config`, `push`, `coupon`, `live-event`, `game-update`, `user-snapshot-clone` |
| 아이템과 경제 | `item-ledger`, `mailbox`, `shop`, `iap`, `offer`, `ads-reward`, `loot-table`, `gacha` |
| 진행 | `mission`, `attendance`, `reset-counter`, `tutorial`, `play-session` |
| 경쟁과 실시간 | `ranking`, `rating`, `matchmaker`, `p2p-signaling` |
| 소셜 | `friend`, `guild`, `chat`, `block-report` |
| 개발과 테스트 (DEV 코드) | `cheat`, `testing` |

## 개발과 릴리즈

코어는 하네스를 통해서만 바뀐다. 사람이 하네스 폴더에서 연 Claude Code 또는 Codex 세션에서 명령을 내리면 에이전트가 일한다.

- `update core: <proposal>`은 코어 제안이나 사람의 요청을 적용한다. 모듈 스펙을 먼저 고치고, 코어 에이전트가 구현하고, 리뷰 에이전트가 확인한 뒤 새 버전을 릴리스한다.
- `create client core: <engine>`은 새 엔진의 클라이언트 코어를 스펙에서 `client/<engine>/`에 만들고 릴리스한다.
- `ogw core release <version>`은 릴리스 조건(테스트, 리뷰, 코드 검사, 최신 `core-spec/`)을 확인하고, main에 `v<version>` 태그를 붙여 애셋과 그 SHA-256을 담은 `manifest.json`으로 GitHub Release를 게시한다.
- 버전 형식은 `<major>.<minor>.<patch>`다. 게시한 애셋은 바뀌지 않고, 수정은 새 버전으로 낸다.
- 게임은 `coreVersion`에 버전을 적는다. 하네스 도구가 그 릴리스를 받아 해시로 확인하고, `ogw generate`가 게임에 복사한다.

<details><summary>코어 개발을 위한 요구 사항과 설치</summary>

요구 사항: [하네스](https://github.com/wnsrn3436/open-game-works-core)의 요구 사항 전부와 다음이 필요하다.

- `client/godot/engine.json`에 적힌 버전의 Godot(`update env`가 설치한다).
- 코어 테스트와 코드 검사가 쓰는 하네스 설정 `tools`: `tools.postgresql`, `tools.chromium`, `tools.gdtoolkit`.
- 릴리스 게시용으로 이 저장소에 대한 push 권한.
- 네이티브 플러그인 재빌드용으로 Xcode, SCons, JDK 17, Android SDK가 있는 Mac. 주 호스트는 macOS다.

설치: 이 저장소를 하네스 옆에 클론하고(하네스는 자기 `settings.json`의 `paths.coreImpl`로 이 폴더를 찾는다), 하네스 README의 [빠른 시작](https://github.com/wnsrn3436/open-game-works-core/blob/main/README.ko.md#빠른-시작)을 따른다. 코어를 개발하는 동안 하네스 설정 `useLocalCore`를 `true`로 두면 하네스 도구가 릴리스 대신 이 폴더를 쓴다.

```sh
cd <workspace>
git clone https://github.com/wnsrn3436/open-game-works-core.git
git clone https://github.com/wnsrn3436/open-game-works-core-impl.git
```

</details>

## 기여

기여를 환영한다. 도움이 가장 필요한 곳은 다음과 같다.

- 다른 엔진의 클라이언트 코어. 지금은 Godot뿐이고, 하네스는 Three.js, Phaser, Unity, Unreal을 목표 엔진으로 둔다.
- 스토어 결제, 광고, 푸시, 소셜 로그인의 실제 어댑터. 아직 실제 서비스에 연결해 본 적이 없다.
- Windows, Android, iOS에서의 `build` 명령. 아직 빌드하거나 배포한 게임이 없다.
- 하네스의 [리소스 제작 스킬](https://github.com/wnsrn3436/open-game-works-core/tree/main/skills/resource): 최종 아트, 사운드 등 리소스 생성.
- open-game-works로 만든 게임과, 코어에 부족했던 점의 보고.

기여하는 방법:
- 질문과 아이디어는 하네스의 [Discussions](https://github.com/wnsrn3436/open-game-works-core/discussions)에, 코어의 버그는 [Issues](https://github.com/wnsrn3436/open-game-works-core-impl/issues)에 올린다. 큰 변경은 먼저 하나를 연다.
- 동작을 바꾸는 변경은 하네스의 스펙 변경에서 시작한다(`update core`, 새 엔진은 `create client core: <engine>`).
- 변경은 건드린 모듈의 `ogw core test`와 `ogw code check core`를 통과해야 한다.
- 코드 식별자와 커밋 메시지는 영어로 쓴다.
- 기여하면 그 기여물이 이 저장소의 라이선스인 Apache License 2.0으로 배포되는 데 동의하는 것으로 본다.

## 라이선스

Apache License 2.0. 전문은 [LICENSE](LICENSE)에 있다. 게임의 `client/core/`와 `server/core/` 폴더는 코어 릴리스의 사본이므로 Apache-2.0을 그대로 따른다.

- 클라이언트에 들어가는 서드파티 구성 요소(엔진과 그 구성 요소, 플러그인과 플러그인 안의 SDK, 코어 코드에 옮겨 온 서드파티 코드)는 [`licenses.json`](licenses.json)에 SPDX 라이선스, 소스 URL, 표시해야 하는 고지문, 플랫폼, 사용하는 코어 모듈과 함께 나열되어 있고, `texts`에 라이선스 전문이 있다. `ogw generate`는 게임마다 이 파일로 `client/generated/licenses.json`을 쓴다.
- 벤치마크 게임은 Noto Sans KR 폰트를 `benchmark/godot/resource/font/main.ttf`로 포함하며, 이 폰트는 SIL Open Font License 1.1을 따른다. 저작권 고지와 라이선스 전문은 [`benchmark/godot/LICENSES/OFL-1.1-NotoSansKR.txt`](benchmark/godot/LICENSES/OFL-1.1-NotoSansKR.txt)에 있고, 이 파일은 폰트와 함께 `benchmark-godot.zip`에 들어간다.
- `.github/media/`의 게임플레이 GIF는 Apache License 2.0의 적용을 받지 않는다. 이 GIF들은 [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)을 따른다([`.github/media/LICENSE`](.github/media/LICENSE) 참고).
