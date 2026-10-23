extends RefCounted
## Little-endian reader of local data file bytes. A read past the end or of a malformed string sets `failed`
## and returns a zero value; reads after that return zero values too.

var failed: bool = false

var _bytes: PackedByteArray = PackedByteArray()
var _position: int = 0


func _init(bytes: PackedByteArray) -> void:
	_bytes = bytes


## Bytes not read yet.
func remaining() -> int:
	return _bytes.size() - _position


func read_u8() -> int:
	if not _has(1):
		return 0
	var value: int = _bytes.decode_u8(_position)
	_position += 1
	return value


func read_u32() -> int:
	if not _has(4):
		return 0
	var value: int = _bytes.decode_u32(_position)
	_position += 4
	return value


func read_s64() -> int:
	if not _has(8):
		return 0
	var value: int = _bytes.decode_s64(_position)
	_position += 8
	return value


func read_double() -> float:
	if not _has(8):
		return 0.0
	var value: float = _bytes.decode_double(_position)
	_position += 8
	return value


## A u32 byte length and that many bytes of well-formed UTF-8 without U+0000.
func read_string() -> String:
	var length: int = read_u32()
	if not _has(length):
		return ""
	var start: int = _position
	_position += length
	if not _is_valid_utf8(start, _position):
		failed = true
		return ""
	return _bytes.slice(start, _position).get_string_from_utf8()


func _has(count: int) -> bool:
	if failed or count < 0 or _bytes.size() - _position < count:
		failed = true
		return false
	return true


## Whether bytes `from` to `to` (exclusive) are well-formed UTF-8 without U+0000: no overlong form, no
## surrogate, nothing above U+10FFFF.
func _is_valid_utf8(from: int, to: int) -> bool:
	var i: int = from
	while i < to:
		var lead: int = _bytes[i]
		if lead == 0:
			return false
		if lead < 0x80:
			i += 1
			continue
		var count: int = 0
		var minimum: int = 0
		var code: int = 0
		if lead >= 0xC2 and lead <= 0xDF:
			count = 1
			minimum = 0x80
			code = lead & 0x1F
		elif lead >= 0xE0 and lead <= 0xEF:
			count = 2
			minimum = 0x800
			code = lead & 0x0F
		elif lead >= 0xF0 and lead <= 0xF4:
			count = 3
			minimum = 0x10000
			code = lead & 0x07
		else:
			return false
		if i + count >= to:
			return false
		for k in range(1, count + 1):
			var next: int = _bytes[i + k]
			if (next & 0xC0) != 0x80:
				return false
			code = (code << 6) | (next & 0x3F)
		if code < minimum or code > 0x10FFFF or (code >= 0xD800 and code <= 0xDFFF):
			return false
		i += count + 1
	return true
