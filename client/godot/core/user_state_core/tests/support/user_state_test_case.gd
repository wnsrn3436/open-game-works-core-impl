extends UnitTestCase
## Base of the UserStateCore core tests: test settings, the module setup with the core test data, server time,
## delta building and the events UserStateCore publishes.

const TAG: String = "UserStateCore"
const MARGIN_MS: int = 500
const MAX_SAFE: int = 9007199254740991
const MAX_SAFE_TEXT: String = "9007199254740991"
## A server time far from game day boundaries and from the live events of the core test data.
const SERVER_TIME: int = 1710000000000

## Every `UserStateChangedEvent` received: `<kind name>|<source>|<upserted ids>|<deleted ids>`, in order.
var changed: PackedStringArray = PackedStringArray()
## Number of `ItemChangedEvent`s and `ItemMailedEvent`s received, and what they carried, in order.
var item_change_events: int = 0
var item_changes: Array[CoreContract.ItemChange] = []
var item_mail_events: int = 0
var item_mails: Array[CoreContract.ItemMail] = []


func before_each() -> void:
	super()
	set_int("TimeCore.reachMarginMs", MARGIN_MS)
	set_int("TimeCore.jumpThresholdMs", 1000000000000)
	set_int("dailyResetOffsetMs", 0)
	changed = PackedStringArray()
	item_change_events = 0
	item_changes = []
	item_mail_events = 0
	item_mails = []


## Releases every initialized module in reverse module list order, `NetworkCore` and its UI modules included.
func after_each() -> void:
	super()
	BootstrapCoreDev.shutdown()


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## Inits UserStateCore and the modules it depends on in module list order, loads the core test data, subscribes to
## the UserStateCore events and, when `server_time` is not 0, syncs the server time to it.
func start(server_time: int = SERVER_TIME) -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	assert_true(TimeCore.init(), "TimeCore.init")
	assert_true(LocalDataCore.init(), "LocalDataCore.init")
	assert_true(DataCore.init(), "DataCore.init")
	assert_true(UserStateCore.init(), "UserStateCore.init")
	assert_true(await DataCore.load(null), "DataCore.load")
	assert_true(EventCore.subscribe(UserStateChangedEvent, _on_user_state_changed))
	assert_true(EventCore.subscribe(ItemChangedEvent, _on_item_changed))
	assert_true(EventCore.subscribe(ItemMailedEvent, _on_item_mailed))
	if server_time != 0:
		sync_to(server_time)


## Syncs with a response received now whose round trip is 0, so the server time becomes `server_time`.
func sync_to(server_time: int) -> void:
	var now: int = TimeCore.get_monotonic_time()
	TimeCore.sync_server_time(server_time, now, now)
	assert_eq(TimeCore.get_server_time(), server_time)


## The ID value of an ID name of the core test data.
func id_of(id_name: String) -> int:
	var value: int = GameDataDev.find_id_value(id_name)
	assert_ne(value, 0, "ID value of %s" % id_name)
	return value


## The cases of a core test fixture, as JSON text each.
# ogw:input_boundary
func fixture_cases(fixture: String) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	var parsed: Variant = JSON.parse_string(UnitTestCore.read_core_fixture(fixture))
	assert_true(parsed is Dictionary, "%s is a JSON object" % fixture)
	if not parsed is Dictionary:
		return out
	var root: Dictionary = parsed
	var cases: Array = root["cases"]
	for each: Variant in cases:
		out.append(JSON.stringify(each))
	return out


## A JSON number of a core test fixture as an int.
# ogw:input_boundary
func json_int(value: Variant) -> int:
	if value is int:
		return value
	if value is float:
		var number: float = value
		return int(number)
	return 0


func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


func warns() -> int:
	return UnitTestCore.check_logs("warn", TAG)


# --- deltas ---


func new_delta(full: bool = false) -> CoreContract.UserStateDelta:
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.full = full
	return delta


## Adds an upsert of `value` to `delta`: kind `kind_name`, item ID `id` (0 for a single kind).
func add_upsert(delta: CoreContract.UserStateDelta, kind_name: String, id: int, value: ContractMessage) -> void:
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = kind_name
	entry.id = id
	entry.value = value.encode()
	delta.entries.append(entry)


func add_delete(delta: CoreContract.UserStateDelta, kind_name: String, id: int) -> void:
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = kind_name
	entry.id = id
	entry.deleted = true
	delta.entries.append(entry)


func tutorial(id: int, step: int) -> CoreContract.TutorialProgressUserState:
	var state: CoreContract.TutorialProgressUserState = CoreContract.TutorialProgressUserState.new()
	state.id = id
	state.step = step
	return state


func add_tutorial(delta: CoreContract.UserStateDelta, id: int, step: int) -> void:
	add_upsert(delta, "TutorialProgressUserState", id, tutorial(id, step))


func get_tutorial(id: int) -> CoreContract.TutorialProgressUserState:
	return UserStateCore.get_by_id(CoreContract.TutorialProgressUserState, id) as CoreContract.TutorialProgressUserState


## Applies a delta that upserts one `ItemBalanceUserState` object.
func put_balance(item_id: int, amount: int, recovery_started_at: int = 0, ends_at: int = 0, big_amount: String = "") -> void:
	var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
	state.id = item_id
	state.amount = amount
	state.recovery_started_at = recovery_started_at
	state.ends_at = ends_at
	state.big_amount = big_amount
	var delta: CoreContract.UserStateDelta = new_delta()
	add_upsert(delta, "ItemBalanceUserState", item_id, state)
	assert_true(UserStateCoreDev.apply_test_delta(delta), "apply ItemBalanceUserState %d" % item_id)


## Applies a delta that upserts one object of list kind `kind_name`.
func put_state(kind_name: String, id: int, value: ContractMessage) -> void:
	var delta: CoreContract.UserStateDelta = new_delta()
	add_upsert(delta, kind_name, id, value)
	assert_true(UserStateCoreDev.apply_test_delta(delta), "apply %s %d" % [kind_name, id])


func item_amount(item_id: int, amount: int, big_amount: String = "") -> CoreContract.ItemAmount:
	var item: CoreContract.ItemAmount = CoreContract.ItemAmount.new()
	item.item_id = item_id
	item.amount = amount
	item.big_amount = big_amount
	return item


# --- events ---


func _on_user_state_changed(event: UserStateChangedEvent) -> void:
	changed.append(change_text(event))


func _on_item_changed(event: ItemChangedEvent) -> void:
	item_change_events += 1
	item_changes.append_array(event.changes)


func _on_item_mailed(event: ItemMailedEvent) -> void:
	item_mail_events += 1
	item_mails.append_array(event.mails)


static func change_text(event: UserStateChangedEvent) -> String:
	return "%s|%d|%s|%s" % [kind_name_of(event.kind), event.source, ids_text(event.upserted_ids), ids_text(event.deleted_ids)]


static func ids_text(ids: PackedInt64Array) -> String:
	var parts: PackedStringArray = PackedStringArray()
	for id: int in ids:
		parts.append(str(id))
	return ",".join(parts)


static func kind_name_of(kind: GDScript) -> String:
	for kinds: Array[ContractKind] in [CoreContract.user_state_kinds(), GameContract.user_state_kinds()]:
		for each: ContractKind in kinds:
			if each.kind_class == kind:
				return each.name
	return "?"


## The `UserStateChangedEvent` texts received for kind `kind_name`.
func changes_of(kind_name: String) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for text: String in changed:
		if text.begins_with(kind_name + "|"):
			out.append(text)
	return out
