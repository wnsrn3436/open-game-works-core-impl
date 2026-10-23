extends RefCounted
## Big integer arithmetic for `UtilCore`. A value is a sign and a magnitude of base 10^9 limbs, least significant limb
## first, with no zero limb at the top. Zero has no limbs and is never negative.

const _BASE: int = 1000000000
const _LIMB_DIGITS: int = 9
const _ZERO_CODE: int = 48
const _NINE_CODE: int = 57
const _MINUS_CODE: int = 45


class Value:
	extends RefCounted
	var negative: bool = false
	var limbs: PackedInt64Array = PackedInt64Array()


## `-?(0|[1-9][0-9]*)` with no `-0`.
static func is_valid(text: String) -> bool:
	var start: int = 1 if text.begins_with("-") else 0
	var length: int = text.length()
	if length == start:
		return false
	var first: int = text.unicode_at(start)
	if first == _ZERO_CODE and length > 1:
		return false
	for i: int in range(start, length):
		var c: int = text.unicode_at(i)
		if c < _ZERO_CODE or c > _NINE_CODE:
			return false
	return true


## Value of a text that passed `is_valid`.
static func parse(text: String) -> Value:
	var value: Value = Value.new()
	var start: int = 0
	if text.unicode_at(0) == _MINUS_CODE:
		value.negative = true
		start = 1
	var end: int = text.length()
	while end > start:
		var chunk_start: int = maxi(start, end - _LIMB_DIGITS)
		value.limbs.append(text.substr(chunk_start, end - chunk_start).to_int())
		end = chunk_start
	_trim(value.limbs)
	if value.limbs.is_empty():
		value.negative = false
	return value


static func from_int(number: int) -> Value:
	return parse(String.num_int64(number))


static func format(value: Value) -> String:
	var count: int = value.limbs.size()
	if count == 0:
		return "0"
	var parts: PackedStringArray = PackedStringArray()
	if value.negative:
		parts.append("-")
	parts.append(String.num_int64(value.limbs[count - 1]))
	for i: int in range(count - 2, -1, -1):
		parts.append(String.num_int64(value.limbs[i]).pad_zeros(_LIMB_DIGITS))
	return "".join(parts)


## −1, 0 or 1.
static func compare(a: Value, b: Value) -> int:
	if a.negative != b.negative:
		return -1 if a.negative else 1
	var order: int = compare_magnitude(a.limbs, b.limbs)
	return -order if a.negative else order


static func add(a: Value, b: Value) -> Value:
	if a.negative == b.negative:
		return _make(a.negative, _add_magnitude(a.limbs, b.limbs))
	var order: int = compare_magnitude(a.limbs, b.limbs)
	if order == 0:
		return Value.new()
	if order > 0:
		return _make(a.negative, _sub_magnitude(a.limbs, b.limbs))
	return _make(b.negative, _sub_magnitude(b.limbs, a.limbs))


static func negate(a: Value) -> Value:
	return _make(not a.negative, a.limbs.duplicate())


static func multiply(a: Value, b: Value) -> Value:
	return _make(a.negative != b.negative, _mul_magnitude(a.limbs, b.limbs))


## a ÷ b rounded toward negative infinity, for b > 0.
static func floor_divide(a: Value, b: Value) -> Value:
	var quotient: PackedInt64Array = PackedInt64Array()
	var has_remainder: bool = _div_magnitude(a.limbs, b.limbs, quotient)
	if a.negative and has_remainder:
		var one: PackedInt64Array = PackedInt64Array()
		one.append(1)
		quotient = _add_magnitude(quotient, one)
	return _make(a.negative, quotient)


static func compare_magnitude(a: PackedInt64Array, b: PackedInt64Array) -> int:
	if a.size() != b.size():
		return -1 if a.size() < b.size() else 1
	for i: int in range(a.size() - 1, -1, -1):
		if a[i] != b[i]:
			return -1 if a[i] < b[i] else 1
	return 0


static func _make(negative: bool, limbs: PackedInt64Array) -> Value:
	var value: Value = Value.new()
	_trim(limbs)
	value.limbs = limbs
	value.negative = negative and not limbs.is_empty()
	return value


static func _trim(limbs: PackedInt64Array) -> void:
	var count: int = limbs.size()
	while count > 0 and limbs[count - 1] == 0:
		count -= 1
	limbs.resize(count)


static func _add_magnitude(a: PackedInt64Array, b: PackedInt64Array) -> PackedInt64Array:
	var count: int = maxi(a.size(), b.size())
	var out: PackedInt64Array = PackedInt64Array()
	out.resize(count + 1)
	var carry: int = 0
	for i: int in count:
		var sum: int = carry
		if i < a.size():
			sum += a[i]
		if i < b.size():
			sum += b[i]
		out[i] = sum % _BASE
		carry = sum / _BASE
	out[count] = carry
	return out


## a − b for a >= b in magnitude.
static func _sub_magnitude(a: PackedInt64Array, b: PackedInt64Array) -> PackedInt64Array:
	var out: PackedInt64Array = PackedInt64Array()
	out.resize(a.size())
	var borrow: int = 0
	for i: int in a.size():
		var diff: int = a[i] - borrow
		if i < b.size():
			diff -= b[i]
		borrow = 0
		if diff < 0:
			diff += _BASE
			borrow = 1
		out[i] = diff
	return out


static func _mul_magnitude(a: PackedInt64Array, b: PackedInt64Array) -> PackedInt64Array:
	var out: PackedInt64Array = PackedInt64Array()
	if a.is_empty() or b.is_empty():
		return out
	out.resize(a.size() + b.size())
	out.fill(0)
	for i: int in a.size():
		var carry: int = 0
		for j: int in b.size():
			var current: int = out[i + j] + a[i] * b[j] + carry
			out[i + j] = current % _BASE
			carry = current / _BASE
		var k: int = i + b.size()
		while carry > 0:
			var current: int = out[k] + carry
			out[k] = current % _BASE
			carry = current / _BASE
			k += 1
	return out


## Fills quotient with |a| ÷ |b| rounded toward zero, for b not zero. Returns whether the remainder is not zero.
static func _div_magnitude(a: PackedInt64Array, b: PackedInt64Array, quotient: PackedInt64Array) -> bool:
	quotient.resize(a.size())
	quotient.fill(0)
	if b.size() == 1:
		var divisor: int = b[0]
		var rest: int = 0
		for i: int in range(a.size() - 1, -1, -1):
			var current: int = rest * _BASE + a[i]
			quotient[i] = current / divisor
			rest = current % divisor
		_trim(quotient)
		return rest != 0
	var remainder: PackedInt64Array = PackedInt64Array()
	for i: int in range(a.size() - 1, -1, -1):
		remainder.insert(0, a[i])
		_trim(remainder)
		# Largest digit d with b × d <= remainder.
		var low: int = 0
		var high: int = _BASE - 1
		while low < high:
			var middle: int = (low + high + 1) / 2
			if compare_magnitude(_mul_small(b, middle), remainder) <= 0:
				low = middle
			else:
				high = middle - 1
		if low > 0:
			remainder = _sub_magnitude(remainder, _mul_small(b, low))
			_trim(remainder)
		quotient[i] = low
	_trim(quotient)
	return not remainder.is_empty()


## a × d for 0 <= d < base.
static func _mul_small(a: PackedInt64Array, d: int) -> PackedInt64Array:
	var out: PackedInt64Array = PackedInt64Array()
	out.resize(a.size() + 1)
	var carry: int = 0
	for i: int in a.size():
		var current: int = a[i] * d + carry
		out[i] = current % _BASE
		carry = current / _BASE
	out[a.size()] = carry
	_trim(out)
	return out
