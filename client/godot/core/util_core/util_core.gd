class_name UtilCore
extends RefCounted
## String, math, collection and big integer operations, PCG32 random and a general state machine shared by core and
## content code. No module state and no lifecycle. Failures return the failure value without a log; the caller logs.

const _BIG := preload("res://core/util_core/util_big_integer.gd")

const _INT64_MAX: int = 9223372036854775807
const _INT64_MIN: int = -9223372036854775807 - 1
const _INT32_MAX: int = 2147483647
const _INT32_MIN: int = -2147483648
const _TWO_32: int = 0x100000000
const _TWO_32_FLOAT: float = 4294967296.0
const _PERMILLE: int = 1000
const _LOWER_A: int = 97
const _LOWER_Z: int = 122
const _DIGIT_0: int = 48
const _DIGIT_9: int = 57
const _UNDERSCORE: int = 95


static func sha256_hex(bytes: PackedByteArray) -> String:
	var context: HashingContext = HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if not bytes.is_empty() and context.update(bytes) != OK:
		return ""
	return context.finish().hex_encode()


static func is_snake_case(text: String) -> bool:
	var length: int = text.length()
	if length == 0:
		return false
	var first: int = text.unicode_at(0)
	if first < _LOWER_A or first > _LOWER_Z:
		return false
	var previous: int = first
	for i: int in range(1, length):
		var c: int = text.unicode_at(i)
		var is_lower: bool = c >= _LOWER_A and c <= _LOWER_Z
		var is_digit: bool = c >= _DIGIT_0 and c <= _DIGIT_9
		if not is_lower and not is_digit and c != _UNDERSCORE:
			return false
		if c == _UNDERSCORE and previous == _UNDERSCORE:
			return false
		previous = c
	return previous != _UNDERSCORE


static func floor_div(a: int, b: int) -> int:
	if b <= 0:
		return 0
	@warning_ignore("integer_division")
	var quotient: int = a / b
	if a % b != 0 and a < 0:
		quotient -= 1
	return quotient


static func floor_mod(a: int, b: int) -> int:
	if b <= 0:
		return 0
	var rest: int = a % b
	if rest < 0:
		rest += b
	return rest


static func clamp_int(value: int, min_value: int, max_value: int) -> int:
	if min_value > max_value:
		return min_value
	if value < min_value:
		return min_value
	if value > max_value:
		return max_value
	return value


static func apply_permille(value: int, permille: int) -> ApplyPermilleResult:
	var result: ApplyPermilleResult = ApplyPermilleResult.new()
	if not _product_fits(value, permille):
		return result
	result.ok = true
	result.value = floor_div(value * permille, _PERMILLE)
	return result


static func big_is_valid(text: String) -> bool:
	return _BIG.is_valid(text)


static func big_from_int(value: int) -> String:
	return String.num_int64(value)


static func big_to_int(text: String) -> BigToIntResult:
	var result: BigToIntResult = BigToIntResult.new()
	if not _BIG.is_valid(text):
		return result
	var negative: bool = text.begins_with("-")
	var digits: String = text.substr(1) if negative else text
	var limit: String = "9223372036854775808" if negative else "9223372036854775807"
	if digits.length() > limit.length() or (digits.length() == limit.length() and digits > limit):
		return result
	var number: int = 0
	for i: int in digits.length():
		var digit: int = digits.unicode_at(i) - _DIGIT_0
		number = number * 10 - digit if negative else number * 10 + digit
	result.ok = true
	result.value = number
	return result


static func big_compare(a: String, b: String) -> BigCompareResult:
	var result: BigCompareResult = BigCompareResult.new()
	if not _BIG.is_valid(a) or not _BIG.is_valid(b):
		return result
	result.ok = true
	result.value = _BIG.compare(_BIG.parse(a), _BIG.parse(b))
	return result


static func big_add(a: String, b: String) -> String:
	if not _BIG.is_valid(a) or not _BIG.is_valid(b):
		return ""
	return _BIG.format(_BIG.add(_BIG.parse(a), _BIG.parse(b)))


static func big_sub(a: String, b: String) -> String:
	if not _BIG.is_valid(a) or not _BIG.is_valid(b):
		return ""
	return _BIG.format(_BIG.add(_BIG.parse(a), _BIG.negate(_BIG.parse(b))))


static func big_mul(a: String, b: String) -> String:
	if not _BIG.is_valid(a) or not _BIG.is_valid(b):
		return ""
	return _BIG.format(_BIG.multiply(_BIG.parse(a), _BIG.parse(b)))


static func big_floor_div(a: String, b: String) -> String:
	if not _BIG.is_valid(a) or not _BIG.is_valid(b):
		return ""
	var divisor: _BIG.Value = _BIG.parse(b)
	if divisor.negative or divisor.limbs.is_empty():
		return ""
	return _BIG.format(_BIG.floor_divide(_BIG.parse(a), divisor))


static func big_apply_permille(value: String, permille: int) -> String:
	if not _BIG.is_valid(value):
		return ""
	var product: _BIG.Value = _BIG.multiply(_BIG.parse(value), _BIG.from_int(permille))
	return _BIG.format(_BIG.floor_divide(product, _BIG.from_int(_PERMILLE)))


static func create_random(seed_value: int) -> UtilRandom:
	return UtilRandom.new(seed_value)


static func make_purpose_seed(purpose_name: String, base: int) -> int:
	return UtilRandom._purpose_seed(purpose_name, base)


## 0 when random is `null`.
static func next_uint32(random: UtilRandom) -> int:
	if random == null:
		return 0
	return random._step()


static func range_int(random: UtilRandom, min_value: int, max_value: int) -> int:
	if random == null or min_value > max_value or min_value < _INT32_MIN or max_value > _INT32_MAX:
		return min_value
	return min_value + random._bounded(max_value - min_value + 1)


## 0.0 when random is `null`.
static func next_float(random: UtilRandom) -> float:
	if random == null:
		return 0.0
	return float(random._step()) / _TWO_32_FLOAT


static func shuffle_indices(random: UtilRandom, count: int) -> PackedInt64Array:
	var indices: PackedInt64Array = PackedInt64Array()
	if random == null or count < 0:
		return indices
	indices.resize(count)
	for i: int in count:
		indices[i] = i
	for i: int in range(count - 1, 0, -1):
		var j: int = random._bounded(i + 1)
		var swap: int = indices[i]
		indices[i] = indices[j]
		indices[j] = swap
	return indices


static func pick_weighted(random: UtilRandom, weights: PackedInt64Array) -> int:
	if random == null:
		return -1
	var sum: int = 0
	for weight: int in weights:
		if weight < 0 or weight > _TWO_32:
			return -1
		sum += weight
		if sum > _TWO_32:
			return -1
	if sum == 0:
		return -1
	var drawn: int = random._bounded(sum)
	var accumulated: int = 0
	for i: int in weights.size():
		accumulated += weights[i]
		if drawn < accumulated:
			return i
	return -1


## `callbacks` maps a listed state to its callbacks. States without an entry have no callbacks.
static func create_state_machine(
	states: PackedInt64Array,
	transitions: Array[UtilStateTransition],
	first_state: int,
	callbacks: Dictionary[int, UtilStateCallbacks]
) -> UtilStateMachine:
	if states.is_empty():
		return null
	var machine: UtilStateMachine = UtilStateMachine.new()
	for state: int in states:
		if machine._callbacks.has(state):
			return null
		machine._callbacks[state] = callbacks[state] if callbacks.has(state) else null
	if not machine._callbacks.has(first_state):
		return null
	for transition: UtilStateTransition in transitions:
		if transition == null:
			return null
		if not machine._callbacks.has(transition.from_state) or not machine._callbacks.has(transition.to_state):
			return null
		var next_states: PackedInt64Array = machine._next_states.get(transition.from_state, PackedInt64Array())
		next_states.append(transition.to_state)
		machine._next_states[transition.from_state] = next_states
	machine._current = first_state
	machine._previous = first_state
	return machine


static func change_state(machine: UtilStateMachine, next_state: int) -> bool:
	if machine == null or machine._in_transition:
		return false
	var current: int = machine._current
	if not machine._next_states.has(current) or not machine._next_states[current].has(next_state):
		return false
	machine._in_transition = true
	var leaving: UtilStateCallbacks = machine._callbacks[current]
	if leaving != null and leaving.on_exit.is_valid():
		leaving.on_exit.call(next_state)
	machine._previous = current
	machine._current = next_state
	machine._elapsed_ms = 0
	var entering: UtilStateCallbacks = machine._callbacks[next_state]
	if entering != null and entering.on_enter.is_valid():
		entering.on_enter.call(current)
	machine._in_transition = false
	return true


static func update_state(machine: UtilStateMachine, elapsed_ms: int) -> void:
	if machine == null or machine._in_transition or elapsed_ms < 0:
		return
	machine._elapsed_ms += elapsed_ms
	var current: UtilStateCallbacks = machine._callbacks[machine._current]
	if current != null and current.on_update.is_valid():
		current.on_update.call(elapsed_ms)


## 0 when machine is `null`.
static func current_state(machine: UtilStateMachine) -> int:
	if machine == null:
		return 0
	return machine._current


## 0 when machine is `null`.
static func previous_state(machine: UtilStateMachine) -> int:
	if machine == null:
		return 0
	return machine._previous


## 0 when machine is `null`.
static func state_elapsed_ms(machine: UtilStateMachine) -> int:
	if machine == null:
		return 0
	return machine._elapsed_ms


## Whether a × b is inside int64.
static func _product_fits(a: int, b: int) -> bool:
	if a == 0 or b == 0:
		return true
	if b == -1:
		return a != _INT64_MIN
	if a == -1:
		return b != _INT64_MIN
	@warning_ignore("integer_division")
	var max_div: int = _INT64_MAX / b
	@warning_ignore("integer_division")
	var min_div: int = _INT64_MIN / b
	if b > 0:
		return a <= max_div and a >= min_div
	return a >= max_div and a <= min_div
