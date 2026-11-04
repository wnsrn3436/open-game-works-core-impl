# review: matchmaker round 1

## findings

none

## previous

none

## out of scope

- server/core/matchmaker/realtime.ts:837: medium With `matchmaker.frameReadTimeoutMs` 0, one partial frame from an unauthenticated client throws out of the socket `data` listener. The schema allows 0 (settings/core-settings.schema.json:689), and `frame_time_limit` calls `server_time.network_time_limit(0n)`, which throws when ms is less than 1 (server/core/server-time/network_time_limit.ts:9). `WebSocketConnection.#read` reaches it through `#time_frame` (server/core/matchmaker/websocket.ts:167, :196). Reproduced on a stream with the real `WebSocketConnection` and `network_time_limit`: `socket.emit('data', Buffer.from([0x82]))` threw `network_time_limit: ms 0 is below 1`. server/core has no `uncaughtException` handler, so a real socket would end the server process; that last step was not run. `matchmaker.helloTimeoutMs` 0 (settings/core-settings.schema.json:697) throws the same way at server/core/matchmaker/realtime.ts:856, where the catch in `upgrade` (server/core/routing/pipeline.ts:823) destroys the socket, so every `/realtime` connection fails after its handshake. The range did not cause this: it raised six other keys to 1, and server/core/routing/tests/settings-minimum.test.ts only starts a server, with no connection, so it passes with both keys at 0. The spec writes no range for either key; the same cause is D5 of records/review-debt/spec-matchmaker.json.
- client/godot/core/realtime_core/p2p_realtime_transport.gd:324: medium The range makes a client that holds a match send `MATCH_LEAVE` of a second `MATCH_FOUND` and keep the first match, but the server has already removed that connection from the first session when it opened the second (server/core/matchmaker/realtime.ts:931, skills `p2p-signaling` `### match session`). The client then counts as left in both matches while it is still playing the first. Run path: host A and member B play match m1 from a room, which stays after the match (open-game-works-core/skills/server-core/modules/matchmaker.md:154). A leaves m1 and sends `ROOM_START` while B is `Playing`; `room_start` (server/core/matchmaker/realtime.ts:718) does not check whether a member is in a match, so m2 is created. Reproduced on the real `SessionStore` (server/core/p2p-signaling/sessions.ts): opening m2 returned `LEFT` of B in m1, B's `MATCH_LEAVE` of m2 returned `LEFT` of B in m2, B's next `PEER_SIGNAL` was dropped with `not_in_session`, and by the code at server/core/p2p-signaling/sessions.ts:191 its `MATCH_REJOIN` of m1 is `ok` `false` because the index is a left index. Result: B stays `Playing` in m1 with `left_at` written (the case at open-game-works-core/skills/server-core/modules/matchmaker.md:374), so a lost P2P connection in m1 cannot signal or rejoin, and in a `ServerReplay` match of 3 or more B's report is not counted and the judgement does not wait for it (matchmaker.md:184, :186). m2 also holds B as left, and A fails at the connect time limit. The client line follows open-game-works-core/skills/client-core/modules/realtime-core.md:298, and the server side follows matchmaker.md:374, so the two specs together set this result; solving it needs a spec change (e.g. `ROOM_START` refused while a member is bound to a running match session, or the client taking the second match).

## debt

none

## must fix

none

## unknown

- The commit range changes no file under server/core/matchmaker. Checked for the range: the schema minimums of `matchmaker.tickMs`, `matchmaker.sweepIntervalMs` and `admin-api.switchCacheMs` against matchmaker.md:261, :264, :283 and core-settings.json defaults; `begin_start` and `schedule_job`; `settings-minimum.test.ts`; that the `block-report` diff does not touch `list_blocked_ids`; and the server handling of the frames the changed client now sends (`MATCH_LEAVE`, `MATCH_CANCEL`, `ROOM_LEAVE`) in realtime.ts and sessions.ts, by reading.
- server/core/matchmaker/results.ts, records.ts and judge.ts were read only at `participant_change`, because no change of the range reaches their judgement or apply logic. Problems in them that predate the range were not looked for. Tests of the module were read only by search for the changed settings and `MATCH_LEAVE`.
- `ogw core test server matchmaker` was not run in this review, so the module tests' state at this commit was not checked here. records/1793766929643-update-core-mw1mil0r76ebb4.md reports a pass for `matchmaker` and `routing` on a4ab109, before the later client commits.
- The new client frames were not run end to end between a real client and a real server. The two reproductions above are unit-level scripts on the named classes, and were run outside the checkout.
- `records/review-debt/matchmaker.json` holds D1 (`collect` in server/core/matchmaker/matching.ts:69), while input `## debt` is `none`. It was not decided here, and it is not repeated in `## out of scope`.
