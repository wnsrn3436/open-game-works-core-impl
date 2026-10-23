class_name UserStateChangedEvent
extends EventBase
## Core event: `UserStateCore.apply_delta` applied entries of one kind, or `set_user_created_at` changed the user
## creation time (kind `ItemBalanceUserState`, source `RESPONSE`, both lists empty).

## Kind class, as `CoreContract.user_state_kinds()` and `GameContract.user_state_kinds()` give it.
var kind: GDScript = null
var source: UserStateCore.DeltaSource = UserStateCore.DeltaSource.RESPONSE
## `id` of each upsert applied, in the order applied. Empty for a single kind.
var upserted_ids: PackedInt64Array = PackedInt64Array()
## `id` of each object taken out of the cache, in the order taken. Empty for a single kind.
var deleted_ids: PackedInt64Array = PackedInt64Array()
