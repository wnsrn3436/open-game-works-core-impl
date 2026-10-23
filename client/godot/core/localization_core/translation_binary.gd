extends RefCounted
## Decoder of a translation binary (`data` skill `tool.md` `## processing`): the protobuf message `Translation` with
## field 1 `repeated TranslationEntry entries`, and `TranslationEntry` with field 1 `string key` and field 2
## `string text`.

const _WIRE_VARINT: int = 0
const _WIRE_FIXED64: int = 1
const _WIRE_LENGTH: int = 2
const _WIRE_FIXED32: int = 5
const _UINT32_MAX: int = 0xFFFFFFFF


## Reads `bytes` into `out` (translation key to text). `false` when the bytes are not a translation binary; `out`
## is then partly filled and the caller drops it.
static func decode(bytes: PackedByteArray, out: Dictionary[String, String]) -> bool:
	var reader: _Reader = _Reader.new(bytes, 0, bytes.size())
	while reader.more():
		var tag: int = reader.tag()
		if reader.failed:
			return false
		if tag >> 3 == 1 and tag & 7 == _WIRE_LENGTH:
			var length: int = reader.length()
			if reader.failed:
				return false
			if not _read_entry(bytes, reader.pos, reader.pos + length, out):
				return false
			reader.pos += length
		else:
			reader.skip(tag & 7)
	return not reader.failed


static func _read_entry(bytes: PackedByteArray, from: int, to: int, out: Dictionary[String, String]) -> bool:
	var reader: _Reader = _Reader.new(bytes, from, to)
	var key: String = ""
	var text: String = ""
	while reader.more():
		var tag: int = reader.tag()
		if reader.failed:
			return false
		var number: int = tag >> 3
		if (number == 1 or number == 2) and tag & 7 == _WIRE_LENGTH:
			var value: String = reader.string()
			if number == 1:
				key = value
			else:
				text = value
		elif number == 1 or number == 2:
			return false
		else:
			reader.skip(tag & 7)
	if reader.failed:
		return false
	out[key] = text
	return true


## Protobuf wire format reader over `[pos, end)` of the bytes. A read that does not fit sets `failed`.
class _Reader extends RefCounted:
	var failed: bool = false
	var pos: int = 0
	var _bytes: PackedByteArray
	var _end: int = 0

	func _init(bytes: PackedByteArray, from: int, to: int) -> void:
		_bytes = bytes
		pos = from
		_end = to

	func more() -> bool:
		return not failed and pos < _end

	## The next tag. Field number 0 and tags over 32 bits fail.
	func tag() -> int:
		var value: int = _varint()
		if value >> 3 == 0 or value < 0 or value > _UINT32_MAX:
			failed = true
			return 0
		return value

	## Length of a length-delimited value; fails when fewer bytes are left.
	func length() -> int:
		var count: int = _varint()
		if failed:
			return 0
		if count < 0 or count > _end - pos:
			failed = true
			return 0
		return count

	## A length-delimited UTF-8 string. Bytes that are not well-formed UTF-8 fail.
	func string() -> String:
		var count: int = length()
		if failed:
			return ""
		if not _is_utf8(pos, pos + count):
			failed = true
			return ""
		var text: String = _bytes.slice(pos, pos + count).get_string_from_utf8()
		pos += count
		return text

	func skip(wire: int) -> void:
		match wire:
			_WIRE_VARINT:
				_varint()
			_WIRE_FIXED64:
				_advance(8)
			_WIRE_LENGTH:
				_advance(length())
			_WIRE_FIXED32:
				_advance(4)
			_:
				failed = true

	func _advance(count: int) -> void:
		if failed:
			return
		if count > _end - pos:
			failed = true
			return
		pos += count

	## Varint as the 64-bit two's complement value. More than 10 bytes or a cut varint fails.
	func _varint() -> int:
		var result: int = 0
		var shift: int = 0
		while shift < 70:
			if pos >= _end:
				failed = true
				return 0
			var b: int = _bytes[pos]
			pos += 1
			if shift == 63:
				result |= (b & 1) << 63
			else:
				result |= (b & 0x7F) << shift
			if b < 0x80:
				return result
			shift += 7
		failed = true
		return 0

	func _is_utf8(from: int, to: int) -> bool:
		var i: int = from
		while i < to:
			var b0: int = _bytes[i]
			if b0 < 0x80:
				i += 1
				continue
			var count: int = _sequence_length(i, to)
			if count == 0:
				return false
			i += count
		return true

	## Length of the well-formed multi-byte UTF-8 sequence at `i` that ends before `to`, or 0.
	func _sequence_length(i: int, to: int) -> int:
		var b0: int = _bytes[i]
		var count: int = 0
		var low: int = 0x80
		var high: int = 0xBF
		if b0 < 0xC2 or b0 > 0xF4:
			return 0
		if b0 <= 0xDF:
			count = 2
		elif b0 <= 0xEF:
			count = 3
			if b0 == 0xE0:
				low = 0xA0
			elif b0 == 0xED:
				high = 0x9F
		else:
			count = 4
			if b0 == 0xF0:
				low = 0x90
			elif b0 == 0xF4:
				high = 0x8F
		if i + count > to:
			return 0
		for k: int in range(1, count):
			var b: int = _bytes[i + k]
			if b < low or b > high:
				return 0
			low = 0x80
			high = 0xBF
		return count
