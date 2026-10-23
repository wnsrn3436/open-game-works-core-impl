class_name ContractMessage
extends RefCounted
## Base of the message classes the contract tool generates. A message class overrides `encode`, `decode` and
## `copy_from`, and uses the protobuf wire format helpers below.

## Nesting limit of decode: deeper input is not a contract message.
const _MAX_DEPTH: int = 100
const _WIRE_VARINT: int = 0
const _WIRE_FIXED64: int = 1
const _WIRE_LENGTH: int = 2
const _WIRE_FIXED32: int = 5
## Mask that keeps the 57 low bits after an arithmetic shift right by 7: a logical shift of a 64-bit value.
const _SHIFT_7_MASK: int = 0x01FFFFFFFFFFFFFF
const _UINT32_MASK: int = 0xFFFFFFFF
const _INT32_SIGN: int = 0x80000000

## Decode nesting depth of the message decode running now.
static var _depth: int = 0


## Protobuf bytes of the message.
func encode() -> PackedByteArray:
	return PackedByteArray()


## Puts every field back to its default value, then reads `bytes`. `false` when the bytes are not this message.
func decode(_bytes: PackedByteArray) -> bool:
	return false


## Puts the field values of `source`, a message of the same class, into this object.
func copy_from(_source: ContractMessage) -> void:
	pass


## Puts every field back to its default value. Message classes override it.
func _reset() -> void:
	pass


## Reads `bytes` into the fields without resetting them first: parsing the concatenation of two encodings merges
## them. Message classes override it.
func _merge(_bytes: PackedByteArray) -> bool:
	return false


## Merges `bytes` into `child` one nesting level deeper.
static func _merge_child(child: ContractMessage, bytes: PackedByteArray) -> bool:
	if _depth >= _MAX_DEPTH:
		return false
	_depth += 1
	var ok: bool = child._merge(bytes)
	_depth -= 1
	return ok


## Varint of the 64-bit two's complement of `value`.
static func _write_varint(out: PackedByteArray, value: int) -> void:
	var rest: int = value
	while true:
		var low: int = rest & 0x7F
		rest = (rest >> 7) & _SHIFT_7_MASK
		if rest == 0:
			out.append(low)
			return
		out.append(low | 0x80)


static func _write_tag(out: PackedByteArray, number: int, wire: int) -> void:
	_write_varint(out, (number << 3) | wire)


static func _write_length_delimited(out: PackedByteArray, number: int, bytes: PackedByteArray) -> void:
	_write_tag(out, number, _WIRE_LENGTH)
	_write_varint(out, bytes.size())
	out.append_array(bytes)


## `value` as an `int32`: its low 32 bits, sign-extended.
static func _to_int32(value: int) -> int:
	return ((value & _UINT32_MASK) ^ _INT32_SIGN) - _INT32_SIGN


static func _write_float(out: PackedByteArray, value: float) -> void:
	var at: int = out.size()
	out.resize(at + 4)
	out.encode_float(at, value)


static func _write_double(out: PackedByteArray, value: float) -> void:
	var at: int = out.size()
	out.resize(at + 8)
	out.encode_double(at, value)


## True for 0.0 and false for -0.0: proto3 leaves out only a positive zero.
static func _is_positive_zero(value: float) -> bool:
	if value != 0.0:
		return false
	var bits: PackedByteArray = PackedByteArray()
	bits.resize(8)
	bits.encode_double(0, value)
	return bits.decode_u64(0) == 0


static func _put_int32(out: PackedByteArray, number: int, value: int) -> void:
	if value == 0:
		return
	_write_tag(out, number, _WIRE_VARINT)
	_write_varint(out, _to_int32(value))


static func _put_int64(out: PackedByteArray, number: int, value: int) -> void:
	if value == 0:
		return
	_write_tag(out, number, _WIRE_VARINT)
	_write_varint(out, value)


static func _put_bool(out: PackedByteArray, number: int, value: bool) -> void:
	if not value:
		return
	_write_tag(out, number, _WIRE_VARINT)
	out.append(1)


static func _put_float(out: PackedByteArray, number: int, value: float) -> void:
	if _is_positive_zero(value):
		return
	_write_tag(out, number, _WIRE_FIXED32)
	_write_float(out, value)


static func _put_double(out: PackedByteArray, number: int, value: float) -> void:
	if _is_positive_zero(value):
		return
	_write_tag(out, number, _WIRE_FIXED64)
	_write_double(out, value)


static func _put_string(out: PackedByteArray, number: int, value: String) -> void:
	if value.is_empty():
		return
	_write_length_delimited(out, number, value.to_utf8_buffer())


static func _put_bytes(out: PackedByteArray, number: int, value: PackedByteArray) -> void:
	if value.is_empty():
		return
	_write_length_delimited(out, number, value)


## A singular message field: left out when `null`.
static func _put_message(out: PackedByteArray, number: int, value: ContractMessage) -> void:
	if value == null:
		return
	_write_length_delimited(out, number, value.encode())


## One element of a repeated message field: a `null` element is an empty message.
static func _put_message_item(out: PackedByteArray, number: int, value: ContractMessage) -> void:
	_write_length_delimited(out, number, PackedByteArray() if value == null else value.encode())


static func _put_int32_list(out: PackedByteArray, number: int, values: PackedInt32Array) -> void:
	if values.is_empty():
		return
	var packed: PackedByteArray = PackedByteArray()
	for value: int in values:
		_write_varint(packed, value)
	_write_length_delimited(out, number, packed)


static func _put_int64_list(out: PackedByteArray, number: int, values: PackedInt64Array) -> void:
	if values.is_empty():
		return
	var packed: PackedByteArray = PackedByteArray()
	for value: int in values:
		_write_varint(packed, value)
	_write_length_delimited(out, number, packed)


static func _put_bool_list(out: PackedByteArray, number: int, values: Array[bool]) -> void:
	if values.is_empty():
		return
	var packed: PackedByteArray = PackedByteArray()
	for value: bool in values:
		packed.append(1 if value else 0)
	_write_length_delimited(out, number, packed)


static func _put_float_list(out: PackedByteArray, number: int, values: PackedFloat32Array) -> void:
	if values.is_empty():
		return
	var packed: PackedByteArray = PackedByteArray()
	for value: float in values:
		_write_float(packed, value)
	_write_length_delimited(out, number, packed)


static func _put_double_list(out: PackedByteArray, number: int, values: PackedFloat64Array) -> void:
	if values.is_empty():
		return
	var packed: PackedByteArray = PackedByteArray()
	for value: float in values:
		_write_double(packed, value)
	_write_length_delimited(out, number, packed)


static func _put_string_list(out: PackedByteArray, number: int, values: PackedStringArray) -> void:
	for value: String in values:
		_write_length_delimited(out, number, value.to_utf8_buffer())


static func _put_bytes_list(out: PackedByteArray, number: int, values: Array[PackedByteArray]) -> void:
	for value: PackedByteArray in values:
		_write_length_delimited(out, number, value)


## Protobuf wire format reader of the generated decode. A read that does not fit the wire type or the bytes sets
## `failed`; reads after that return default values.
class _WireReader extends RefCounted:
	var failed: bool = false
	var _bytes: PackedByteArray
	var _pos: int = 0
	var _end: int = 0

	func _init(bytes: PackedByteArray) -> void:
		_bytes = bytes
		_end = bytes.size()

	## True while bytes are left and nothing failed.
	func more() -> bool:
		return not failed and _pos < _end

	## The tag of the next field: field number and wire type. Field number 0 and tags over 32 bits fail.
	func tag() -> int:
		var value: int = _varint()
		if value >> 3 == 0 or value < 0 or value > ContractMessage._UINT32_MASK:
			failed = true
			return 0
		return value

	func skip(wire: int) -> void:
		match wire:
			ContractMessage._WIRE_VARINT:
				_varint()
			ContractMessage._WIRE_FIXED64:
				_advance(8)
			ContractMessage._WIRE_LENGTH:
				_advance(_length())
			ContractMessage._WIRE_FIXED32:
				_advance(4)
			_:
				failed = true

	func int32(wire: int) -> int:
		if not _expect(wire, ContractMessage._WIRE_VARINT):
			return 0
		return ContractMessage._to_int32(_varint())

	func int64(wire: int) -> int:
		if not _expect(wire, ContractMessage._WIRE_VARINT):
			return 0
		return _varint()

	func boolean(wire: int) -> bool:
		if not _expect(wire, ContractMessage._WIRE_VARINT):
			return false
		return _varint() != 0

	func float32(wire: int) -> float:
		if not _expect(wire, ContractMessage._WIRE_FIXED32) or not _has(4):
			return 0.0
		var value: float = _bytes.decode_float(_pos)
		_pos += 4
		return value

	func float64(wire: int) -> float:
		if not _expect(wire, ContractMessage._WIRE_FIXED64) or not _has(8):
			return 0.0
		var value: float = _bytes.decode_double(_pos)
		_pos += 8
		return value

	func bytes(wire: int) -> PackedByteArray:
		if not _expect(wire, ContractMessage._WIRE_LENGTH):
			return PackedByteArray()
		var count: int = _length()
		if failed:
			return PackedByteArray()
		var out: PackedByteArray = _bytes.slice(_pos, _pos + count)
		_pos += count
		return out

	## A string field. Bytes that are not well-formed UTF-8 fail.
	func string(wire: int) -> String:
		var raw: PackedByteArray = bytes(wire)
		if failed:
			return ""
		if not _is_utf8(raw):
			failed = true
			return ""
		return raw.get_string_from_utf8()

	func int32_list(wire: int) -> PackedInt32Array:
		var out: PackedInt32Array = PackedInt32Array()
		if wire == ContractMessage._WIRE_LENGTH:
			var to: int = _packed_end()
			while not failed and _pos < to:
				out.append(ContractMessage._to_int32(_varint()))
			_close(to)
		else:
			var value: int = int32(wire)
			if not failed:
				out.append(value)
		return out

	func int64_list(wire: int) -> PackedInt64Array:
		var out: PackedInt64Array = PackedInt64Array()
		if wire == ContractMessage._WIRE_LENGTH:
			var to: int = _packed_end()
			while not failed and _pos < to:
				out.append(_varint())
			_close(to)
		else:
			var value: int = int64(wire)
			if not failed:
				out.append(value)
		return out

	func boolean_list(wire: int) -> Array[bool]:
		var out: Array[bool] = []
		if wire == ContractMessage._WIRE_LENGTH:
			var to: int = _packed_end()
			while not failed and _pos < to:
				out.append(_varint() != 0)
			_close(to)
		else:
			var value: bool = boolean(wire)
			if not failed:
				out.append(value)
		return out

	func float32_list(wire: int) -> PackedFloat32Array:
		var out: PackedFloat32Array = PackedFloat32Array()
		if wire == ContractMessage._WIRE_LENGTH:
			var to: int = _packed_end()
			while not failed and _pos < to:
				out.append(float32(ContractMessage._WIRE_FIXED32))
			_close(to)
		else:
			var value: float = float32(wire)
			if not failed:
				out.append(value)
		return out

	func float64_list(wire: int) -> PackedFloat64Array:
		var out: PackedFloat64Array = PackedFloat64Array()
		if wire == ContractMessage._WIRE_LENGTH:
			var to: int = _packed_end()
			while not failed and _pos < to:
				out.append(float64(ContractMessage._WIRE_FIXED64))
			_close(to)
		else:
			var value: float = float64(wire)
			if not failed:
				out.append(value)
		return out

	func _expect(wire: int, expected: int) -> bool:
		if wire != expected:
			failed = true
		return not failed

	func _has(count: int) -> bool:
		if count > _end - _pos:
			failed = true
		return not failed

	func _advance(count: int) -> void:
		if _has(count):
			_pos += count

	## Varint as the 64-bit two's complement value. More than 10 bytes or a cut varint fails.
	func _varint() -> int:
		var result: int = 0
		var shift: int = 0
		while shift < 70:
			if not _has(1):
				return 0
			var b: int = _bytes[_pos]
			_pos += 1
			if shift == 63:
				result |= (b & 1) << 63
			else:
				result |= (b & 0x7F) << shift
			if b < 0x80:
				return result
			shift += 7
		failed = true
		return 0

	## Length of a length-delimited value; fails when the bytes left are fewer.
	func _length() -> int:
		var count: int = _varint()
		if failed:
			return 0
		if count < 0 or count > _end - _pos:
			failed = true
			return 0
		return count

	## End position of a packed repeated field that starts here.
	func _packed_end() -> int:
		var count: int = _length()
		return _pos + count

	## After a packed field: the last value must end where the field ends.
	func _close(to: int) -> void:
		if _pos != to:
			failed = true

	static func _is_utf8(raw: PackedByteArray) -> bool:
		var i: int = 0
		var size: int = raw.size()
		while i < size:
			var b0: int = raw[i]
			if b0 < 0x80:
				i += 1
				continue
			var length: int = _sequence_length(raw, i)
			if length == 0:
				return false
			i += length
		return true

	## Length of the well-formed multi-byte UTF-8 sequence at `i`, or 0.
	static func _sequence_length(raw: PackedByteArray, i: int) -> int:
		var b0: int = raw[i]
		var length: int = 0
		var low: int = 0x80
		var high: int = 0xBF
		if b0 < 0xC2 or b0 > 0xF4:
			return 0
		if b0 <= 0xDF:
			length = 2
		elif b0 <= 0xEF:
			length = 3
			if b0 == 0xE0:
				low = 0xA0
			elif b0 == 0xED:
				high = 0x9F
		else:
			length = 4
			if b0 == 0xF0:
				low = 0x90
			elif b0 == 0xF4:
				high = 0x8F
		if i + length > raw.size():
			return 0
		for k: int in range(1, length):
			var b: int = raw[i + k]
			if b < low or b > high:
				return 0
			low = 0x80
			high = 0xBF
		return length
