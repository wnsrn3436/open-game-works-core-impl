extends UnitTestCase
## State machine: transitions, callbacks, elapsed time and creation failures.

const StateProbe := preload("res://core/util_core/tests/support/state_probe.gd")
const StateCallLog := preload("res://core/util_core/tests/support/state_call_log.gd")

const IDLE: int = 0
const RUN: int = 1
const JUMP: int = 2

var _log: StateCallLog = StateCallLog.new()
var _probes: Array[StateProbe] = []


func after_each() -> void:
	super()
	for probe: StateProbe in _probes:
		if probe != null:
			probe.free()
	_probes.clear()
	_log.clear()


static func _transitions() -> Array[UtilStateTransition]:
	return [UtilStateTransition.new(IDLE, RUN), UtilStateTransition.new(RUN, IDLE), UtilStateTransition.new(RUN, JUMP)]


func _probe(state: int) -> StateProbe:
	var probe: StateProbe = StateProbe.new(state, _log)
	_probes.append(probe)
	return probe


func _machine_with_probes() -> UtilStateMachine:
	var callbacks: Dictionary[int, UtilStateCallbacks] = {}
	for state: int in PackedInt64Array([IDLE, RUN, JUMP]):
		callbacks[state] = _probe(state).callbacks()
	var machine: UtilStateMachine = UtilCore.create_state_machine(PackedInt64Array([IDLE, RUN, JUMP]), _transitions(), IDLE, callbacks)
	for probe: StateProbe in _probes:
		probe.machine = machine
	return machine


func test_creation_calls_no_callback_and_starts_at_the_first_state() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	assert_not_null(machine)
	assert_eq(UtilCore.current_state(machine), IDLE)
	assert_eq(UtilCore.previous_state(machine), IDLE)
	assert_eq(UtilCore.state_elapsed_ms(machine), 0)
	assert_eq(_log.lines, PackedStringArray())


func test_allowed_transition_calls_on_exit_then_on_enter_once_and_resets_elapsed() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	UtilCore.update_state(machine, 16)
	_log.clear()
	assert_true(UtilCore.change_state(machine, RUN))
	assert_eq(_log.lines, PackedStringArray(["exit 0 to 1", "enter 1 from 0"]))
	assert_eq(UtilCore.current_state(machine), RUN)
	assert_eq(UtilCore.previous_state(machine), IDLE)
	assert_eq(UtilCore.state_elapsed_ms(machine), 0)


func test_transition_not_in_the_list_is_false_and_keeps_the_state() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	UtilCore.update_state(machine, 16)
	_log.clear()
	assert_false(UtilCore.change_state(machine, JUMP))
	assert_false(UtilCore.change_state(machine, IDLE))
	assert_false(UtilCore.change_state(machine, 99))
	assert_eq(_log.lines, PackedStringArray())
	assert_eq(UtilCore.current_state(machine), IDLE)
	assert_eq(UtilCore.state_elapsed_ms(machine), 16)


func test_change_state_and_update_state_inside_on_enter_do_nothing() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	_probes[RUN].nested_target = IDLE
	assert_true(UtilCore.change_state(machine, RUN))
	assert_eq(_probes[RUN].nested_results, [false, true])
	assert_eq(UtilCore.current_state(machine), RUN)
	assert_eq(UtilCore.state_elapsed_ms(machine), 0)
	assert_eq(_log.lines, PackedStringArray(["exit 0 to 1", "enter 1 from 0"]))


func test_change_state_and_update_state_inside_on_exit_do_nothing() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	_probes[IDLE].nested_target = RUN
	assert_true(UtilCore.change_state(machine, RUN))
	assert_eq(_probes[IDLE].nested_results, [false, true])
	assert_eq(UtilCore.current_state(machine), RUN)
	assert_eq(_log.lines, PackedStringArray(["exit 0 to 1", "enter 1 from 0"]))


func test_update_state_adds_elapsed_and_calls_on_update() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	UtilCore.update_state(machine, 16)
	UtilCore.update_state(machine, 16)
	assert_eq(UtilCore.state_elapsed_ms(machine), 32)
	assert_eq(_log.lines, PackedStringArray(["update 0 16", "update 0 16"]))


func test_update_state_with_negative_ms_does_nothing() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	UtilCore.update_state(machine, 16)
	UtilCore.update_state(machine, -1)
	assert_eq(UtilCore.state_elapsed_ms(machine), 16)
	assert_eq(_log.lines, PackedStringArray(["update 0 16"]))


func test_same_state_needs_its_own_transition() -> void:
	var transitions: Array[UtilStateTransition] = [UtilStateTransition.new(IDLE, IDLE)]
	var callbacks: Dictionary[int, UtilStateCallbacks] = {IDLE: _probe(IDLE).callbacks()}
	var machine: UtilStateMachine = UtilCore.create_state_machine(PackedInt64Array([IDLE, RUN]), transitions, IDLE, callbacks)
	UtilCore.update_state(machine, 16)
	_log.clear()
	assert_true(UtilCore.change_state(machine, IDLE))
	assert_eq(_log.lines, PackedStringArray(["exit 0 to 0", "enter 0 from 0"]))
	assert_eq(UtilCore.state_elapsed_ms(machine), 0)
	assert_false(UtilCore.change_state(machine, RUN))


func test_states_without_callbacks_change_without_calls() -> void:
	var empty: Dictionary[int, UtilStateCallbacks] = {}
	var machine: UtilStateMachine = UtilCore.create_state_machine(PackedInt64Array([IDLE, RUN, JUMP]), _transitions(), IDLE, empty)
	UtilCore.update_state(machine, 5)
	assert_true(UtilCore.change_state(machine, RUN))
	assert_true(UtilCore.change_state(machine, JUMP))
	assert_eq(UtilCore.current_state(machine), JUMP)
	assert_eq(UtilCore.previous_state(machine), RUN)


func test_destroyed_callback_object_is_skipped_without_log() -> void:
	var machine: UtilStateMachine = _machine_with_probes()
	_probes[IDLE].free()
	_probes[IDLE] = null
	_probes[RUN].free()
	_probes[RUN] = null
	assert_true(UtilCore.change_state(machine, RUN))
	assert_eq(UtilCore.current_state(machine), RUN)
	UtilCore.update_state(machine, 16)
	assert_eq(UtilCore.state_elapsed_ms(machine), 16)
	assert_true(UtilCore.change_state(machine, JUMP))
	assert_eq(_log.lines, PackedStringArray(["enter 2 from 1"]))


func test_create_state_machine_rejects_bad_input() -> void:
	var empty: Dictionary[int, UtilStateCallbacks] = {}
	var none: Array[UtilStateTransition] = []
	var outside_from: Array[UtilStateTransition] = [UtilStateTransition.new(7, IDLE)]
	var outside_to: Array[UtilStateTransition] = [UtilStateTransition.new(IDLE, 7)]
	assert_null(UtilCore.create_state_machine(PackedInt64Array(), none, IDLE, empty), "empty states")
	assert_null(UtilCore.create_state_machine(PackedInt64Array([IDLE, RUN, IDLE]), none, IDLE, empty), "duplicate state")
	assert_null(UtilCore.create_state_machine(PackedInt64Array([IDLE, RUN]), outside_from, IDLE, empty), "from outside")
	assert_null(UtilCore.create_state_machine(PackedInt64Array([IDLE, RUN]), outside_to, IDLE, empty), "to outside")
	assert_null(UtilCore.create_state_machine(PackedInt64Array([IDLE, RUN]), none, JUMP, empty), "first state outside")
	assert_not_null(UtilCore.create_state_machine(PackedInt64Array([IDLE]), none, IDLE, empty))
