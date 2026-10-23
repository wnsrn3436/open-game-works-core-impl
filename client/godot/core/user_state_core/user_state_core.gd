class_name UserStateCore
extends RefCounted
## Keeps the UserState the server sent as the client cache, applies UserState deltas and tells of them by hooks and
## events. Computes, the same way as the server modules, item balances (recovery, group, timed and big items), item
## grant previews, counts with a reset, mission and attendance progress, live event rounds and offer periods.

## Where a delta came from: a response's `user_state` or its `pending_user_state`.
enum DeltaSource { RESPONSE, PENDING }
## `ItemAddPreview` of server `item-ledger`.
enum ItemAddPreview { APPLIED, CONVERTED, DISCARDED, MAILED }

const _TAG: String = "UserStateCore"
const _MARGIN_KEY: String = "TimeCore.reachMarginMs"
const _KIND_CACHE := preload("res://core/user_state_core/kind_cache.gd")
const _MAX_SAFE: int = 9007199254740991
const _MAX_SAFE_TEXT: String = "9007199254740991"
const _INT64_MAX: int = 9223372036854775807
const _INT32_MAX: int = 2147483647
# Indexes of the values `_recovery_state` returns: the stored S, the cap C, the balance B and the intervals n.
const _S: int = 1
const _C: int = 2
const _B: int = 3
const _N: int = 4

static var _is_initialized: bool = false
## Replaced by every `init`. An `apply_delta` that sees another session after a hook stops.
static var _session: RefCounted = null
## Every kind of the base proto and the game contract, in kind order.
static var _kind_list: Array[_KIND_CACHE] = []
static var _kinds_by_name: Dictionary[String, _KIND_CACHE] = {}
static var _kinds_by_class: Dictionary[GDScript, _KIND_CACHE] = {}
## The time `set_user_created_at` got. 0: none.
static var _user_created_at: int = 0
## Live event ID values not in `live_event` that `get_live_event_round` logged since `init`.
static var _logged_live_events: Dictionary[int, bool] = {}


# --- lifecycle ---


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_int(_MARGIN_KEY):
		LogCore.log_error(_TAG, "init: core settings key %s is missing or not an integer" % _MARGIN_KEY)
		return false
	_session = RefCounted.new()
	for kinds: Array[ContractKind] in [CoreContract.user_state_kinds(), GameContract.user_state_kinds()]:
		for kind: ContractKind in kinds:
			var cache: _KIND_CACHE = _KIND_CACHE.new(kind.name, kind.kind_class, kind.is_list)
			_kind_list.append(cache)
			_kinds_by_name[kind.name] = cache
			_kinds_by_class[kind.kind_class] = cache
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_is_initialized = false
	_session = null
	_kind_list = []
	_kinds_by_name = {}
	_kinds_by_class = {}
	_user_created_at = 0
	_logged_live_events = {}


static func is_initialized() -> bool:
	return _is_initialized


# --- delta ---


## Applies a UserState delta in entry order. `false`, with nothing applied, when the delta does not follow the
## contract; then a `RestartRequestedEvent` follows.
static func apply_delta(delta: CoreContract.UserStateDelta, source: DeltaSource) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "apply_delta: not initialized")
		return false
	if source != DeltaSource.RESPONSE and source != DeltaSource.PENDING:
		LogCore.log_error(_TAG, "apply_delta: source %d is not a DeltaSource" % source)
		return false
	return _apply(delta, source)


static func notify_item_changes(changes: Array[CoreContract.ItemChange]) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "notify_item_changes: not initialized")
		return
	if changes.is_empty():
		return
	var event := EventCore.acquire(ItemChangedEvent) as ItemChangedEvent
	if event == null:
		return
	event.changes = changes
	EventCore.publish(event)


static func notify_item_mails(mails: Array[CoreContract.ItemMail]) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "notify_item_mails: not initialized")
		return
	if mails.is_empty():
		return
	var event := EventCore.acquire(ItemMailedEvent) as ItemMailedEvent
	if event == null:
		return
	event.mails = mails
	EventCore.publish(event)


## Registers the `after_update` hook of `kind`, a static func that takes the object an upsert applied.
static func register_after_update(kind: GDScript, hook: Callable) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "register_after_update: not initialized")
		return false
	if not _kinds_by_class.has(kind):
		LogCore.log_error(_TAG, "register_after_update: the kind is not a UserState kind of this build")
		return false
	if not (hook.is_valid() and hook.is_standard() and hook.get_object() is Script):
		LogCore.log_error(_TAG, "register_after_update: the hook is not a static func")
		return false
	var cache: _KIND_CACHE = _kinds_by_class[kind]
	if not cache.after_update.is_null():
		LogCore.log_error(_TAG, "register_after_update: %s has a hook already; the later hook is ignored" % cache.name)
		return false
	cache.after_update = hook
	return true


# --- cache ---


## The cached object of list kind `kind` whose `id` is `id`; null when there is none. The spec name is `get`, which
## GDScript cannot declare: it is a method of `Object`.
static func get_by_id(kind: GDScript, id: int) -> ContractMessage:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_by_id: not initialized")
		return null
	var cache: _KIND_CACHE = _cache_of(kind, true, "get_by_id")
	if cache == null:
		return null
	return cache.find(id)


## The cached object of single kind `kind`; null when there is none.
static func get_single(kind: GDScript) -> ContractMessage:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_single: not initialized")
		return null
	var cache: _KIND_CACHE = _cache_of(kind, false, "get_single")
	if cache == null:
		return null
	return cache.single


## The number of cached objects of list kind `kind`. 0 for any other kind.
static func count(kind: GDScript) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "count: not initialized")
		return 0
	if not _kinds_by_class.has(kind):
		return 0
	var cache: _KIND_CACHE = _kinds_by_class[kind]
	return cache.objects.size() if cache.is_list else 0


## Fills `buffer` from index 0 with the cached objects of list kind `kind`, in no set order; the number filled.
## The buffer keeps its size. When the objects do not fit, it fills the buffer and logs an error.
static func list(kind: GDScript, buffer: Array[ContractMessage]) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "list: not initialized")
		return 0
	var cache: _KIND_CACHE = _cache_of(kind, true, "list")
	if cache == null:
		return 0
	var filled: int = 0
	for object: ContractMessage in cache.objects.values():
		if filled >= buffer.size():
			LogCore.log_error(_TAG, "list: %d objects of %s do not fit a buffer of %d" % [cache.objects.size(), cache.name, buffer.size()])
			break
		buffer[filled] = object
		filled += 1
	return filled


## The change number of `kind`: the number of entries applied to it since `init`. 0 for a kind of no contract.
static func get_change_number(kind: GDScript) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_change_number: not initialized")
		return 0
	if not _kinds_by_class.has(kind):
		return 0
	return _kinds_by_class[kind].change_number


# --- items ---


## The balance of an item: with the recovery up to now for a recovery item, the sum of the members for a group item,
## 1 during the effect of a timed item and 0 after it, and at most 2^53−1 for a big item.
static func get_item_balance(item_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_item_balance: not initialized")
		return 0
	return _balance(item_id, _server_now())


## (next recovery time, cap time) of a recovery item. Both 0 when it is not recovering.
static func get_item_recovery(item_id: int) -> GetItemRecoveryResult:
	var result: GetItemRecoveryResult = GetItemRecoveryResult.new()
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_item_recovery: not initialized")
		return result
	if not GameData.ItemRecoveryTable.has_row(item_id) or not TimeCore.is_synced():
		return result
	var recovery: GameData.ItemRecoveryRow = GameData.ItemRecoveryTable.get_row(item_id)
	var state: PackedInt64Array = _recovery_state(item_id, recovery, TimeCore.get_server_time())
	var started: int = state[_S]
	var cap: int = state[_C]
	var balance: int = state[_B]
	if started == 0 or balance >= cap:
		return result
	var interval_start: int = started + state[_N] * recovery.recovery_interval
	result.next_at = interval_start + recovery.recovery_interval
	result.cap_at = interval_start + _ceil_div(cap - balance, recovery.recovery_amount) * recovery.recovery_interval
	return result


## The balance of an item as a big integer.
static func get_item_big_balance(item_id: int) -> String:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_item_big_balance: not initialized")
		return "0"
	return _big_balance(item_id, _server_now())


## The end time of a timed item during its effect; 0 when the effect ended or the item is not a timed item.
static func get_item_ends_at(item_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_item_ends_at: not initialized")
		return 0
	if not GameData.ItemTimedTable.has_row(item_id):
		return 0
	return _timed_ends_at(item_id, _server_now())


## What a grant of `items` would do, one row per item in input order, as server `item-ledger` `preview_add_items`
## computes it. Empty, with an error log, when the input check fails.
static func preview_item_add(items: Array[CoreContract.ItemAmount]) -> Array[ItemAddPreviewRow]:
	var rows: Array[ItemAddPreviewRow] = []
	if not _is_initialized:
		LogCore.log_error(_TAG, "preview_item_add: not initialized")
		return rows
	var amounts: PackedStringArray = PackedStringArray()
	var problem: String = _preview_input_problem(items, amounts)
	if problem != "":
		LogCore.log_error(_TAG, "preview_item_add: %s; no rows" % problem)
		return rows
	# Values by item: the balance, or the remaining ms of a timed item, as big integers, all at one server time.
	var now: int = _server_now()
	var values: Dictionary[int, String] = {}
	var overflows: PackedStringArray = PackedStringArray()
	var mailed: bool = false
	for i: int in items.size():
		var row: ItemAddPreviewRow = ItemAddPreviewRow.new()
		row.item_id = items[i].item_id
		rows.append(row)
		var outcome: PackedStringArray = PackedStringArray() if mailed else _preview_add(row.item_id, amounts[i], values, now)
		if outcome.is_empty():
			mailed = true
			continue
		_set_applied(row, outcome[0])
		_set_overflow(row, outcome[1])
		overflows.append(outcome[1])
	for i: int in items.size():
		if mailed:
			break
		var converts: bool = GameData.ItemTable.get_row(rows[i].item_id).overflow == GameData.ItemOverflow.CONVERT
		if converts and not _is_zero(overflows[i]) and not _preview_convert(rows[i].item_id, overflows[i], values, rows[i].replacements, now):
			mailed = true
	for i: int in items.size():
		var row: ItemAddPreviewRow = rows[i]
		if mailed:
			row.outcome = ItemAddPreview.MAILED
			row.applied = 0
			row.big_applied = ""
			row.overflow = 0
			row.big_overflow = ""
			row.replacements.clear()
		elif _is_zero(overflows[i]):
			row.outcome = ItemAddPreview.APPLIED
		elif GameData.ItemTable.get_row(row.item_id).overflow == GameData.ItemOverflow.CONVERT and _no_replacement_overflow(row.replacements):
			row.outcome = ItemAddPreview.CONVERTED
		else:
			row.outcome = ItemAddPreview.DISCARDED
	return rows


static func get_user_created_at() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_user_created_at: not initialized")
		return 0
	return _user_created_at


## Keeps the user creation time (Unix ms). A new value publishes `UserStateChangedEvent` of `ItemBalanceUserState`.
static func set_user_created_at(created_at: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_user_created_at: not initialized")
		return
	if created_at == _user_created_at:
		return
	_user_created_at = created_at
	var event := EventCore.acquire(UserStateChangedEvent) as UserStateChangedEvent
	if event == null:
		return
	event.kind = CoreContract.ItemBalanceUserState
	event.source = DeltaSource.RESPONSE
	event.upserted_ids = PackedInt64Array()
	event.deleted_ids = PackedInt64Array()
	EventCore.publish(event)


# --- counts with a reset ---


## The purchase count of a shop product in the current limit period.
static func get_shop_purchase_count(product_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_shop_purchase_count: not initialized")
		return 0
	var state := _find(CoreContract.ShopPurchaseUserState, product_id) as CoreContract.ShopPurchaseUserState
	if state == null:
		return 0
	var live_event: int = 0
	var offer: int = 0
	if GameData.ShopProductTable.has_row(product_id):
		var product: GameData.ShopProductRow = GameData.ShopProductTable.get_row(product_id)
		live_event = product.live_event
		offer = product.offer
	if _is_round_reset(live_event, state.event_round) or _is_offer_reset(offer, state.reset_at):
		return 0
	if _is_reset(state.reset_at):
		return 0
	return state.count


## The purchase count of `iap` for an IAP product. Only a `Consumable` product follows the round reset.
static func get_iap_purchase_count(product_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_iap_purchase_count: not initialized")
		return 0
	var state := _find(CoreContract.IapPurchaseUserState, product_id) as CoreContract.IapPurchaseUserState
	if state == null:
		return 0
	var live_event: int = 0
	var offer: int = 0
	if GameData.IapProductTable.has_row(product_id):
		var product: GameData.IapProductRow = GameData.IapProductTable.get_row(product_id)
		if product.type == GameData.IapProductType.CONSUMABLE:
			live_event = product.live_event
		offer = product.offer
	if _is_round_reset(live_event, state.event_round) or _is_offer_reset(offer, state.reset_at):
		return 0
	if _is_reset(state.reset_at):
		return 0
	return state.count


## The reward count of an ad placement in the current limit period.
static func get_ad_reward_count(placement_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_ad_reward_count: not initialized")
		return 0
	var state := _find(CoreContract.AdRewardCountUserState, placement_id) as CoreContract.AdRewardCountUserState
	if state == null or _is_reset(state.reset_at):
		return 0
	return state.count


## The count of a reset counter in the current reset cycle.
static func get_reset_counter(counter_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_reset_counter: not initialized")
		return 0
	var state := _find(CoreContract.ResetCounterUserState, counter_id) as CoreContract.ResetCounterUserState
	if state == null or _is_reset(state.reset_at):
		return 0
	return state.count


## (progress, claimed) of a mission; (0, false) after its round reset or once `reset_at` is not before the end.
static func get_mission_progress(mission_id: int) -> GetMissionProgressResult:
	var result: GetMissionProgressResult = GetMissionProgressResult.new()
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_mission_progress: not initialized")
		return result
	var state := _find(CoreContract.MissionProgressUserState, mission_id) as CoreContract.MissionProgressUserState
	if state == null:
		return result
	var live_event: int = 0
	if GameData.MissionTable.has_row(mission_id):
		live_event = GameData.MissionTable.get_row(mission_id).live_event
	if _is_round_reset(live_event, state.event_round):
		return result
	if state.reset_at != 0 and not TimeCore.is_before_end(state.reset_at):
		return result
	result.progress = state.progress
	result.claimed = state.claimed
	return result


## (day, next day) of an attendance calendar, the same values as server `attendance` `get_attendance`.
static func get_attendance(calendar_id: int) -> GetAttendanceResult:
	var result: GetAttendanceResult = GetAttendanceResult.new()
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_attendance: not initialized")
		return result
	if not GameData.AttendanceCalendarTable.has_row(calendar_id):
		return result
	var calendar: GameData.AttendanceCalendarRow = GameData.AttendanceCalendarTable.get_row(calendar_id)
	var today: int = TimeCore.get_day_number(TimeCore.get_current_day())
	var day: int = 0
	var claimed_day: int = 0
	var reset_at: int = 0
	var event_round: int = 0
	var state := _find(CoreContract.AttendanceUserState, calendar_id) as CoreContract.AttendanceUserState
	if state != null:
		day = state.day
		claimed_day = state.claimed_day_number
		reset_at = state.reset_at
		event_round = state.event_round
	if _is_round_reset(calendar.live_event, event_round):
		# The progress starts again, and `reset_at` becomes the next reset, a time not reached yet.
		day = 0
		claimed_day = 0
		reset_at = 0
	if _is_reset(reset_at):
		day = 0
		claimed_day = 0
	if calendar.mode == GameData.AttendanceMode.STREAK and claimed_day != 0 and today - claimed_day > 1:
		day = 0
	result.day = day
	if claimed_day == today or not _in_period(calendar.start_at, calendar.end_at, calendar.live_event):
		return result
	var day_count: int = 0
	if GameData.AttendanceRewardTable.has_rows(calendar_id):
		day_count = GameData.AttendanceRewardTable.get_rows(calendar_id).size()
	if day_count == 0:
		return result
	if day < day_count:
		result.next_day = day + 1
	elif calendar.mode != GameData.AttendanceMode.ONCE:
		result.next_day = 1
	return result


# --- periods ---


## The active round of a live event, the next round with `round` 0, or all 0, as server `live-event` `get_round`.
static func get_live_event_round(event_id: int) -> GetLiveEventRoundResult:
	var result: GetLiveEventRoundResult = GetLiveEventRoundResult.new()
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_live_event_round: not initialized")
		return result
	_round_of(event_id, result)
	return result


static func is_offer_active(offer_id: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_offer_active: not initialized")
		return false
	var state: CoreContract.OfferUserState = _offer_state(offer_id)
	if state == null:
		return false
	return TimeCore.is_before_end(state.started_at + GameData.OfferTable.get_row(offer_id).duration)


## The end time of the offer as last triggered; 0 when it was never triggered in the current round.
static func get_offer_ends_at(offer_id: int) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_offer_ends_at: not initialized")
		return 0
	var state: CoreContract.OfferUserState = _offer_state(offer_id)
	if state == null:
		return 0
	return state.started_at + GameData.OfferTable.get_row(offer_id).duration


## Whether now is in the period of a data row's `start_at`, `end_at` and live event. 0 is none.
static func is_in_period(start_at: int, end_at: int, live_event_id: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_in_period: not initialized")
		return false
	return _in_period(start_at, end_at, live_event_id)


# --- delta apply ---


## `apply_delta` past its lifecycle and input checks. The DEV `apply_test_delta` calls it too.
static func _apply(delta: CoreContract.UserStateDelta, source: DeltaSource) -> bool:
	var decoded: Array[ContractMessage] = []
	var upserts: Dictionary[String, bool] = {}
	var problem: String = _check_delta(delta, decoded, upserts)
	if problem != "":
		LogCore.log_error(_TAG, "apply_delta: the delta does not follow the contract (%s); nothing is applied" % problem)
		var event := EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
		if event != null:
			event.module = _TAG
			EventCore.publish(event)
		return false
	for cache: _KIND_CACHE in _kind_list:
		cache.begin_apply()
	var session: RefCounted = _session
	if delta.full:
		_delete_all_but(upserts)
	for i: int in delta.entries.size():
		var entry: CoreContract.UserStateEntry = delta.entries[i]
		if not _kinds_by_name.has(entry.kind):
			LogCore.log_warn(_TAG, "apply_delta: skips an entry of kind %s, which this build does not know" % entry.kind)
			continue
		var cache: _KIND_CACHE = _kinds_by_name[entry.kind]
		if entry.deleted:
			_delete(cache, entry.id)
		else:
			_upsert(cache, entry.id, decoded[i])
			if session != _session:
				return false
	for cache: _KIND_CACHE in _kind_list:
		if not cache.applied:
			continue
		var event := EventCore.acquire(UserStateChangedEvent) as UserStateChangedEvent
		if event == null:
			continue
		event.kind = cache.kind_class
		event.source = source
		event.upserted_ids = cache.upserted_ids
		event.deleted_ids = cache.deleted_ids
		EventCore.publish(event)
		if session != _session:
			return true
	return true


## The first way the delta breaks the contract; an empty string when it follows it. Fills `decoded` with the
## decoded object of each upsert of a known kind (null for the other entries) and `upserts` with their keys.
static func _check_delta(delta: CoreContract.UserStateDelta, decoded: Array[ContractMessage], upserts: Dictionary[String, bool]) -> String:
	if delta == null:
		return "no delta"
	var seen: Dictionary[String, bool] = {}
	for entry: CoreContract.UserStateEntry in delta.entries:
		decoded.append(null)
		if entry == null:
			return "an entry is null"
		if not _kinds_by_name.has(entry.kind):
			continue
		var cache: _KIND_CACHE = _kinds_by_name[entry.kind]
		if not cache.is_list and entry.id != 0:
			return "an entry of single kind %s has id %d" % [entry.kind, entry.id]
		var key: String = _entry_key(entry.kind, entry.id)
		if seen.has(key):
			return "two entries of kind %s and id %d" % [entry.kind, entry.id]
		seen[key] = true
		if entry.deleted:
			if not entry.value.is_empty():
				return "a delete of kind %s and id %d has a value" % [entry.kind, entry.id]
			continue
		var object: ContractMessage = cache.kind_class.new()
		if object == null or not object.decode(entry.value):
			return "the value of kind %s and id %d does not decode" % [entry.kind, entry.id]
		decoded[decoded.size() - 1] = object
		upserts[key] = true
	return ""


static func _entry_key(kind_name: String, id: int) -> String:
	return "%s %d" % [kind_name, id]


## A full delta: takes every cached object out of the cache except those the delta upserts.
static func _delete_all_but(upserts: Dictionary[String, bool]) -> void:
	for cache: _KIND_CACHE in _kind_list:
		if not cache.is_list:
			if cache.single != null and not upserts.has(_entry_key(cache.name, 0)):
				_delete(cache, 0)
			continue
		for id: int in cache.objects.keys():
			if not upserts.has(_entry_key(cache.name, id)):
				_delete(cache, id)


static func _delete(cache: _KIND_CACHE, id: int) -> void:
	if cache.is_list:
		if not cache.objects.has(id):
			return
		cache.objects.erase(id)
		cache.deleted_ids.append(id)
	else:
		if cache.single == null:
			return
		cache.single = null
	cache.change_number += 1
	cache.applied = true


static func _upsert(cache: _KIND_CACHE, id: int, value: ContractMessage) -> void:
	var target: ContractMessage = cache.find(id)
	if target != null:
		target.copy_from(value)
	else:
		target = value
		if cache.is_list:
			cache.objects[id] = target
		else:
			cache.single = target
	if cache.is_list:
		cache.upserted_ids.append(id)
	cache.change_number += 1
	cache.applied = true
	if not cache.after_update.is_null():
		var mark: int = CoreScriptErrors.begin()
		cache.after_update.call(target)
		if CoreScriptErrors.end(mark):
			LogCore.log_error(_TAG, "after_update hook of %s threw for id %d" % [cache.name, id])


## The cache of `kind` when it is a list kind (`list`) or a single kind (not `list`); null with an error log otherwise.
static func _cache_of(kind: GDScript, list: bool, operation: String) -> _KIND_CACHE:
	if _kinds_by_class.has(kind):
		var cache: _KIND_CACHE = _kinds_by_class[kind]
		if cache.is_list == list:
			return cache
	LogCore.log_error(_TAG, "%s: the kind is not a %s kind of this build" % [operation, "list" if list else "single"])
	return null


## The cached object of list kind `kind` and `id`, without a log; null when there is none.
static func _find(kind: GDScript, id: int) -> ContractMessage:
	if not _kinds_by_class.has(kind):
		return null
	return _kinds_by_class[kind].find(id)


static func _balance_state(item_id: int) -> CoreContract.ItemBalanceUserState:
	return _find(CoreContract.ItemBalanceUserState, item_id) as CoreContract.ItemBalanceUserState


# --- item balance ---


static func _balance(item_id: int, now: int) -> int:
	if GameData.ItemRecoveryTable.has_row(item_id):
		return _recovery_state(item_id, GameData.ItemRecoveryTable.get_row(item_id), now)[_B]
	if GameData.ItemGroupTable.has_row(item_id):
		var sum: int = 0
		for member: int in GameData.ItemGroupTable.get_row(item_id).members:
			sum += _balance(member, now)
		return sum
	if GameData.ItemTimedTable.has_row(item_id):
		return 1 if _timed_ends_at(item_id, now) != 0 else 0
	if GameData.ItemBigTable.has_row(item_id):
		var big: String = _big_balance(item_id, now)
		return _MAX_SAFE if _big_less(_MAX_SAFE_TEXT, big) else big.to_int()
	var state: CoreContract.ItemBalanceUserState = _balance_state(item_id)
	return 0 if state == null else state.amount


## The stored A and S, the recovery cap C, and, at server time `now`, the balance B and the intervals passed n, in
## this order. B is A and n is 0 when nothing recovers or before the first sync.
static func _recovery_state(item_id: int, recovery: GameData.ItemRecoveryRow, now: int) -> PackedInt64Array:
	var cap: int = recovery.recovery_cap
	if recovery.cap_bonus_item != 0:
		cap += _balance(recovery.cap_bonus_item, now)
	var amount: int = recovery.initial_amount
	var started: int = 0
	var state: CoreContract.ItemBalanceUserState = _balance_state(item_id)
	if state != null:
		amount = state.amount
		started = state.recovery_started_at
	elif amount < cap:
		started = _user_created_at
	var out: PackedInt64Array = PackedInt64Array([amount, started, cap, amount, 0])
	if started == 0 or amount >= cap or recovery.recovery_interval < 1 or recovery.recovery_amount < 1:
		return out
	if not TimeCore.is_synced():
		return out
	var passed: int = maxi(0, UtilCore.floor_div(now - started, recovery.recovery_interval))
	out[_N] = passed
	if passed >= _ceil_div(cap - amount, recovery.recovery_amount):
		out[_B] = cap
	else:
		out[_B] = amount + passed * recovery.recovery_amount
	return out


## The server time one operation computes with; 0 before the first sync, when every reader of it returns early.
static func _server_now() -> int:
	return TimeCore.get_server_time() if TimeCore.is_synced() else 0


## The end time of a timed item while server time `now` is before it; 0 otherwise and before the first sync.
static func _timed_ends_at(item_id: int, now: int) -> int:
	var state: CoreContract.ItemBalanceUserState = _balance_state(item_id)
	if state == null or state.ends_at == 0 or not TimeCore.is_synced():
		return 0
	return state.ends_at if now < state.ends_at else 0


static func _big_balance(item_id: int, now: int) -> String:
	if not GameData.ItemBigTable.has_row(item_id):
		return UtilCore.big_from_int(_balance(item_id, now))
	var state: CoreContract.ItemBalanceUserState = _balance_state(item_id)
	if state == null:
		return "0"
	if state.big_amount != "" and UtilCore.big_is_valid(state.big_amount):
		return state.big_amount
	return UtilCore.big_from_int(state.amount)


## ⌈a ÷ b⌉ for a ≥ 0 and b ≥ 1; 0 for a ≤ 0.
static func _ceil_div(a: int, b: int) -> int:
	if a <= 0 or b < 1:
		return 0
	return (a - 1) / b + 1


# --- item grant preview ---


## The input check of `preview_item_add`: an empty string, with the amount of each item in `amounts`, or the problem.
static func _preview_input_problem(items: Array[CoreContract.ItemAmount], amounts: PackedStringArray) -> String:
	var seen: Dictionary[int, bool] = {}
	for item: CoreContract.ItemAmount in items:
		if item == null:
			return "an ItemAmount is null"
		if not GameData.ItemTable.has_row(item.item_id):
			return "item %d is not in the item table" % item.item_id
		if GameData.ItemGroupTable.has_row(item.item_id):
			return "item %d is a group item" % item.item_id
		if seen.has(item.item_id):
			return "item %d is in the list twice" % item.item_id
		seen[item.item_id] = true
		var amount: String = UtilCore.big_from_int(item.amount)
		if item.big_amount != "":
			if not UtilCore.big_is_valid(item.big_amount):
				return "big_amount of item %d is not a big integer" % item.item_id
			amount = item.big_amount
		if _big_less(amount, "1") or _big_less(_amount_limit(item.item_id), amount):
			return "the amount of item %d is out of range" % item.item_id
		amounts.append(amount)
	return ""


## The amount limit of an item: 10^`max_digits` − 1 for a big item, 2^53−1 for the others.
static func _amount_limit(item_id: int) -> String:
	if GameData.ItemBigTable.has_row(item_id):
		return "9".repeat(GameData.ItemBigTable.get_row(item_id).max_digits)
	return _MAX_SAFE_TEXT


## The balance limit of an item: 10^`max_digits` − 1 for a big item, `max_amount` for the others.
static func _balance_limit(item_id: int) -> String:
	if GameData.ItemBigTable.has_row(item_id):
		return _amount_limit(item_id)
	return UtilCore.big_from_int(GameData.ItemTable.get_row(item_id).max_amount)


## The value of an item in a preview at server time `now`: the balance before the grant, or the remaining ms of a
## timed item.
static func _preview_value(item_id: int, values: Dictionary[int, String], now: int) -> String:
	if values.has(item_id):
		return values[item_id]
	var value: String
	if GameData.ItemTimedTable.has_row(item_id):
		var ends_at: int = _timed_ends_at(item_id, now)
		value = UtilCore.big_from_int(maxi(0, ends_at - now) if ends_at != 0 else 0)
	else:
		value = _big_balance(item_id, now)
	values[item_id] = value
	return value


## Change order 3 of one listed item: (applied, overflow), or empty when the grant ends as `LIMIT_EXCEEDED`.
static func _preview_add(item_id: int, amount: String, values: Dictionary[int, String], now: int) -> PackedStringArray:
	var item: GameData.ItemRow = GameData.ItemTable.get_row(item_id)
	var value: String = _preview_value(item_id, values, now)
	if GameData.ItemTimedTable.has_row(item_id):
		var duration: String = UtilCore.big_from_int(GameData.ItemTimedTable.get_row(item_id).duration)
		var room: String = UtilCore.big_sub(UtilCore.big_mul(UtilCore.big_from_int(item.max_amount), duration), value)
		var kept: String = amount
		if _big_less(room, UtilCore.big_mul(amount, duration)):
			if item.overflow != GameData.ItemOverflow.DISCARD:
				return PackedStringArray()
			kept = _big_max(UtilCore.big_floor_div(room, duration), "0")
		values[item_id] = UtilCore.big_add(value, UtilCore.big_mul(kept, duration))
		return PackedStringArray([kept, UtilCore.big_sub(amount, kept)])
	var limit: String = _balance_limit(item_id)
	var next: String = UtilCore.big_add(value, amount)
	if not _big_less(limit, next):
		values[item_id] = next
		return PackedStringArray([amount, "0"])
	if item.overflow != GameData.ItemOverflow.DISCARD and item.overflow != GameData.ItemOverflow.CONVERT:
		return PackedStringArray()
	var fits: String = _big_min(amount, _big_max(UtilCore.big_sub(limit, value), "0"))
	values[item_id] = UtilCore.big_add(value, fits)
	return PackedStringArray([fits, UtilCore.big_sub(amount, fits)])


## The `Convert` replacement grants of `overflowed` of an item into `grants`; `false` when one ends as
## `LIMIT_EXCEEDED`.
static func _preview_convert(item_id: int, overflowed: String, values: Dictionary[int, String], grants: Array[ItemAddPreviewReplacement], now: int) -> bool:
	if not GameData.ItemOverflowTable.has_row(item_id):
		return true
	for each: CoreContract.ItemAmount in GameData.ItemOverflowTable.get_row(item_id).convert_to:
		var per_one: String = each.big_amount if each.big_amount != "" else UtilCore.big_from_int(each.amount)
		var amount: String = UtilCore.big_mul(per_one, overflowed)
		if not GameData.ItemTable.has_row(each.item_id):
			return false
		var target: GameData.ItemRow = GameData.ItemTable.get_row(each.item_id)
		var value: String = _preview_value(each.item_id, values, now)
		var limit: String = _balance_limit(each.item_id)
		var fits: String = amount
		if _big_less(limit, UtilCore.big_add(value, amount)):
			if target.overflow != GameData.ItemOverflow.DISCARD:
				return false
			fits = _big_min(amount, _big_max(UtilCore.big_sub(limit, value), "0"))
		values[each.item_id] = UtilCore.big_add(value, fits)
		var grant: ItemAddPreviewReplacement = ItemAddPreviewReplacement.new()
		grant.item_id = each.item_id
		var fits_pair: PackedStringArray = _big_pair(fits)
		grant.applied = fits_pair[0].to_int()
		grant.big_applied = fits_pair[1]
		var left_pair: PackedStringArray = _big_pair(UtilCore.big_sub(amount, fits))
		grant.overflow = left_pair[0].to_int()
		grant.big_overflow = left_pair[1]
		grants.append(grant)
	return true


static func _no_replacement_overflow(grants: Array[ItemAddPreviewReplacement]) -> bool:
	for grant: ItemAddPreviewReplacement in grants:
		if grant.overflow != 0 or grant.big_overflow != "":
			return false
	return true


static func _set_applied(row: ItemAddPreviewRow, value: String) -> void:
	var pair: PackedStringArray = _big_pair(value)
	row.applied = pair[0].to_int()
	row.big_applied = pair[1]


static func _set_overflow(row: ItemAddPreviewRow, value: String) -> void:
	var pair: PackedStringArray = _big_pair(value)
	row.overflow = pair[0].to_int()
	row.big_overflow = pair[1]


## A big integer as the contract big encoding pair (small value text, big field): the value and "" when its absolute
## value is at most 2^53−1, else "0" and the value.
static func _big_pair(value: String) -> PackedStringArray:
	var magnitude: String = value.trim_prefix("-")
	if _big_less(_MAX_SAFE_TEXT, magnitude):
		return PackedStringArray(["0", value])
	return PackedStringArray([value, ""])


## a < b for big integers a and b.
static func _big_less(a: String, b: String) -> bool:
	return UtilCore.big_sub(a, b).begins_with("-")


static func _big_min(a: String, b: String) -> String:
	return a if _big_less(a, b) else b


static func _big_max(a: String, b: String) -> String:
	return b if _big_less(a, b) else a


static func _is_zero(value: String) -> bool:
	return value == "0"


# --- reset and period ---


## Whether a stored `reset_at` is reached: the row reads as reset.
static func _is_reset(reset_at: int) -> bool:
	return reset_at != 0 and TimeCore.is_reached(reset_at)


## The offer reset of server `offer` purchase limit read: a product of an offer whose stored `reset_at` is not the
## offer end time of the last trigger. The offer was triggered again, or reads as never triggered.
static func _is_offer_reset(offer_id: int, reset_at: int) -> bool:
	if offer_id == 0 or reset_at == 0:
		return false
	var state: CoreContract.OfferUserState = _offer_state(offer_id)
	var offer_ends_at: int = 0
	if state != null:
		offer_ends_at = state.started_at + GameData.OfferTable.get_row(offer_id).duration
	return reset_at != offer_ends_at


## The round reset of server `live-event`: the data row's live event has an active round other than `event_round`.
static func _is_round_reset(live_event_id: int, event_round: int) -> bool:
	if live_event_id == 0:
		return false
	var round_now: GetLiveEventRoundResult = GetLiveEventRoundResult.new()
	_round_of(live_event_id, round_now)
	return round_now.round != 0 and round_now.round != event_round


static func _in_period(start_at: int, end_at: int, live_event_id: int) -> bool:
	if start_at != 0 and not TimeCore.is_reached(start_at):
		return false
	if end_at != 0 and not TimeCore.is_before_end(end_at):
		return false
	if live_event_id != 0:
		var round_now: GetLiveEventRoundResult = GetLiveEventRoundResult.new()
		_round_of(live_event_id, round_now)
		if round_now.round == 0:
			return false
	return true


## The offer state as the round reset reads it; null for no state, a state of `trigger_count` 0 and an offer not in
## the `offer` table.
static func _offer_state(offer_id: int) -> CoreContract.OfferUserState:
	if not GameData.OfferTable.has_row(offer_id):
		return null
	var state := _find(CoreContract.OfferUserState, offer_id) as CoreContract.OfferUserState
	if state == null or state.trigger_count == 0:
		return null
	if _is_round_reset(GameData.OfferTable.get_row(offer_id).live_event, state.event_round):
		return null
	return state


## Fills `out` with the round of server `live-event` `get_round` for a live event: the active round, or `round` 0
## with the next round, or all 0. A round is active when its start is reached and it is before its end. An event not
## in `live_event` gives all 0 and an error log, once per event until `release`.
static func _round_of(event_id: int, out: GetLiveEventRoundResult) -> void:
	if not GameData.LiveEventTable.has_row(event_id):
		if not _logged_live_events.has(event_id):
			_logged_live_events[event_id] = true
			LogCore.log_error(_TAG, "get_live_event_round: live event %d is not in the live_event table" % event_id)
		return
	var row: GameData.LiveEventRow = GameData.LiveEventTable.get_row(event_id)
	var start: int = row.start_at
	var end: int = row.end_at
	var repeat: int = row.repeat
	# The last round: one without `repeat`; with it, the rounds before `repeat_until` whose end time and number fit.
	var last: int = 1
	if start < 0 or end < 0:
		last = 0
	elif repeat > 0:
		last = mini((_INT64_MAX - end) / repeat + 1, _INT32_MAX)
		if row.repeat_until > 0:
			last = mini(last, _ceil_div(row.repeat_until - start, repeat))
	# The rounds whose start is reached are a prefix of 1..last.
	var low: int = 0
	var high: int = last
	while low < high:
		var middle: int = (low + high + 1) / 2
		if TimeCore.is_reached(start + (middle - 1) * repeat):
			low = middle
		else:
			high = middle - 1
	if low > 0 and TimeCore.is_before_end(end + (low - 1) * repeat):
		out.round = low
		out.start_at = start + (low - 1) * repeat
		out.end_at = end + (low - 1) * repeat
		return
	if low + 1 > last:
		return
	out.start_at = start + low * repeat
	out.end_at = end + low * repeat
