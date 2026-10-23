extends UnitTestCase
## Base of the RequirementCore core tests: test settings, the module setup with the core test data, the flag judge
## hooks, UserState deltas, triggers and the trigger events.

const Hooks := preload("res://core/requirement_core/tests/support/requirement_hooks.gd")
const Recorder := preload("res://core/requirement_core/tests/support/requirement_recorder.gd")
const Probe := preload("res://core/requirement_core/tests/support/requirement_probe.gd")
const TestEvent := preload("res://core/requirement_core/tests/support/requirement_test_event.gd")

const TAG: String = "RequirementCore"
const MARGIN_MS: int = 500
const RECHECK_MS: int = 1000
const MAX_ROUNDS: int = 4
## A server time far from game day boundaries.
const SERVER_TIME: int = 1710000000000

# `requirement` rows of the core test data, by ID name.
## `FlagA()`.
const SINGLE: String = "[req__game_setting__value__validation_req_single__1]"
## `FlagA() & FlagB() & FlagC()`: 1 is `All`, 2 to 4 are the flags.
const ALL_1: String = "[req__game_setting__value__validation_req_all__1]"
const ALL_2: String = "[req__game_setting__value__validation_req_all__2]"
const ALL_3: String = "[req__game_setting__value__validation_req_all__3]"
const ALL_4: String = "[req__game_setting__value__validation_req_all__4]"
## `FlagA() | FlagB()`: 1 is `Any`, 2 and 3 are the flags.
const ANY_1: String = "[req__game_setting__value__validation_req_any__1]"
const ANY_2: String = "[req__game_setting__value__validation_req_any__2]"
const ANY_3: String = "[req__game_setting__value__validation_req_any__3]"
## `FlagA() & (FlagB() | FlagC())`: 1 is `All`, 2 `FlagA`, 3 `Any`, 4 `FlagB`, 5 `FlagC`.
const NESTED_1: String = "[req__game_setting__value__validation_req_nested__1]"
const NESTED_2: String = "[req__game_setting__value__validation_req_nested__2]"
const NESTED_3: String = "[req__game_setting__value__validation_req_nested__3]"
const NESTED_4: String = "[req__game_setting__value__validation_req_nested__4]"
const NESTED_5: String = "[req__game_setting__value__validation_req_nested__5]"
## Another `FlagA()` row.
const OTHER_A: String = "[req__attendance_calendar__requirement__attendance_locked__1]"
## `Level(1)`: `value` 1.
const LEVEL: String = "[req__gacha_banner__requirement__gacha_banner_locked__1]"
## `ShopRank(1)`.
const SHOP_RANK: String = "[req__shop_product__requirement__shop_locked__1]"

const FLAG_A: GameData.RequirementType = GameData.RequirementType.FLAG_A
const FLAG_B: GameData.RequirementType = GameData.RequirementType.FLAG_B
const FLAG_C: GameData.RequirementType = GameData.RequirementType.FLAG_C
const TYPE_LEVEL: GameData.RequirementType = GameData.RequirementType.LEVEL
const TYPE_SHOP_RANK: GameData.RequirementType = GameData.RequirementType.SHOP_RANK

const GUIDE_A: String = "requirement_test.guide_a"
const GUIDE_B: String = "requirement_test.guide_b"
const GUIDE_C: String = "requirement_test.guide_c"
const GUIDE_LEVEL: String = "requirement_test.guide_level"

var _tutorial_step: int = 0


func before_each() -> void:
	super()
	Hooks.reset()
	_tutorial_step = 0
	set_int("RequirementCore.maxBatchRounds", MAX_ROUNDS)
	set_int("RequirementCore.timeRecheckMs", RECHECK_MS)
	set_int("TimeCore.reachMarginMs", MARGIN_MS)
	set_int("TimeCore.jumpThresholdMs", 1000000000000)
	set_int("dailyResetOffsetMs", 0)


func after_each() -> void:
	super()
	RequirementCore.release()
	UserStateCore.release()
	DataCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()


func set_int(key: String, value: int) -> void:
	assert_true(UnitTestCore.set_test_settings(key, value), key)


## Inits the modules RequirementCore reads in module list order, loads the core test data when `load_data`, syncs the
## server time to `server_time` when it is not 0, then inits RequirementCore.
func start(server_time: int = SERVER_TIME, load_data: bool = true) -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_true(EventCore.init(), "EventCore.init")
	assert_true(TimeCore.init(), "TimeCore.init")
	assert_true(LocalDataCore.init(), "LocalDataCore.init")
	assert_true(DataCore.init(), "DataCore.init")
	assert_true(UserStateCore.init(), "UserStateCore.init")
	if load_data:
		assert_true(await DataCore.load(null), "DataCore.load")
	if server_time != 0:
		sync_to(server_time)
	assert_true(RequirementCore.init(), "RequirementCore.init")


## Syncs with a response received now whose round trip is 0, so the server time becomes `server_time`.
func sync_to(server_time: int) -> void:
	var now: int = TimeCore.get_monotonic_time()
	TimeCore.sync_server_time(server_time, now, now)
	assert_eq(TimeCore.get_server_time(), server_time)


## Registers the flag judge hooks: `FlagA` reads `TutorialProgressUserState`, `FlagB` reads `ItemBalanceUserState`,
## `FlagC` reads nothing.
func register_flags(c_time_dependent: bool = false) -> void:
	var a_kinds: Array[GDScript] = [CoreContract.TutorialProgressUserState]
	var b_kinds: Array[GDScript] = [CoreContract.ItemBalanceUserState]
	var no_kinds: Array[GDScript] = []
	assert_true(RequirementCore.register_judge(FLAG_A, Hooks.flag, a_kinds, GUIDE_A), "register FlagA")
	assert_true(RequirementCore.register_judge(FLAG_B, Hooks.flag, b_kinds, GUIDE_B), "register FlagB")
	assert_true(RequirementCore.register_judge(FLAG_C, Hooks.flag, no_kinds, GUIDE_C, Callable(), c_time_dependent), "register FlagC")


## Releases and inits RequirementCore again, which drops every cache, and registers the flag judge hooks.
func restart() -> void:
	RequirementCore.release()
	assert_true(RequirementCore.init(), "RequirementCore.init")
	register_flags()


func answer(a: bool, b: bool = false, c: bool = false) -> void:
	Hooks.answers[FLAG_A] = a
	Hooks.answers[FLAG_B] = b
	Hooks.answers[FLAG_C] = c


## The ID value of an ID name of the core test data.
func id_of(id_name: String) -> int:
	var value: int = GameDataDev.find_id_value(id_name)
	assert_ne(value, 0, "ID value of %s" % id_name)
	return value


func errors() -> int:
	return UnitTestCore.check_logs("error", TAG)


func frame() -> void:
	await UnitTestCore.wait_frames(1)


## Asserts the three fields of `result`.
func assert_result(result: RequirementResult, passed: bool, failed_id: int, guide_key: String, text: String = "") -> void:
	assert_eq(result.passed, passed, text + ": passed")
	assert_eq(result.failed_requirement_id, failed_id, text + ": failed_requirement_id")
	assert_eq(result.guide_key, guide_key, text + ": guide_key")


# --- UserState deltas ---


func _apply(kind_name: String, id: int, value: ContractMessage) -> void:
	var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
	entry.kind = kind_name
	entry.id = id
	entry.value = value.encode()
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	delta.entries.append(entry)
	assert_true(UserStateCoreDev.apply_test_delta(delta), "apply %s %d" % [kind_name, id])


## Applies a delta of `TutorialProgressUserState`, the kind `FlagA` reads.
func put_tutorial() -> void:
	_tutorial_step += 1
	var state: CoreContract.TutorialProgressUserState = CoreContract.TutorialProgressUserState.new()
	state.id = id_of("[tutorial_first]")
	state.step = _tutorial_step
	_apply("TutorialProgressUserState", state.id, state)


## Applies a delta of `ItemBalanceUserState`, the kind `FlagB` reads.
func put_balance(item_id: int, amount: int, recovery_started_at: int = 0) -> void:
	var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
	state.id = item_id
	state.amount = amount
	state.recovery_started_at = recovery_started_at
	_apply("ItemBalanceUserState", item_id, state)


## Applies one delta with an `ItemBalanceUserState` entry of `amount` for each of `item_ids`, in order.
func put_balances(item_ids: PackedInt32Array, amount: int) -> void:
	var delta: CoreContract.UserStateDelta = CoreContract.UserStateDelta.new()
	for item_id: int in item_ids:
		var state: CoreContract.ItemBalanceUserState = CoreContract.ItemBalanceUserState.new()
		state.id = item_id
		state.amount = amount
		var entry: CoreContract.UserStateEntry = CoreContract.UserStateEntry.new()
		entry.kind = "ItemBalanceUserState"
		entry.id = item_id
		entry.value = state.encode()
		delta.entries.append(entry)
	assert_true(UserStateCoreDev.apply_test_delta(delta), "apply ItemBalanceUserState %s" % item_ids)


## Applies a delta of `ShopPurchaseUserState`, a kind no flag reads.
func put_shop(product_id: int, count: int, reset_at: int) -> void:
	var state: CoreContract.ShopPurchaseUserState = CoreContract.ShopPurchaseUserState.new()
	state.id = product_id
	state.count = count
	state.reset_at = reset_at
	_apply("ShopPurchaseUserState", product_id, state)


# --- triggers and trigger events ---


func user_state_trigger(kind: GDScript = null) -> RequirementTrigger:
	var trigger: RequirementTrigger = RequirementTrigger.new()
	trigger.kind = RequirementCore.TriggerKind.USER_STATE_CHANGED
	trigger.user_state_kind = kind
	return trigger


func named_trigger(kind: RequirementCore.TriggerKind, target_name: String) -> RequirementTrigger:
	var trigger: RequirementTrigger = RequirementTrigger.new()
	trigger.kind = kind
	trigger.target_name = target_name
	return trigger


func content_trigger() -> RequirementTrigger:
	var trigger: RequirementTrigger = RequirementTrigger.new()
	trigger.kind = RequirementCore.TriggerKind.CONTENT_EVENT
	trigger.event_type = TestEvent
	return trigger


func triggers(trigger: RequirementTrigger) -> Array[RequirementTrigger]:
	var out: Array[RequirementTrigger] = [trigger]
	return out


func publish_request_completed(request_name: String, success: bool) -> void:
	var event := EventCore.acquire(RequestCompletedEvent) as RequestCompletedEvent
	event.request_name = request_name
	event.success = success
	EventCore.publish(event)


func publish_ui_opened(key: String) -> void:
	var event := EventCore.acquire(UIOpenedEvent) as UIOpenedEvent
	event.key = key
	event.is_panel = true
	EventCore.publish(event)


func publish_ui_closed(key: String) -> void:
	var event := EventCore.acquire(UIClosedEvent) as UIClosedEvent
	event.key = key
	event.is_panel = true
	EventCore.publish(event)


func publish_content() -> void:
	var event := EventCore.acquire(TestEvent) as TestEvent
	event.value += 1
	EventCore.publish(event)


## A probe node of the default process priority in the tree, which `autofree` frees after the test.
func probe(recorder: Recorder) -> Probe:
	var node: Probe = Probe.new()
	node.recorder = recorder
	add_child_autofree(node)
	return node
