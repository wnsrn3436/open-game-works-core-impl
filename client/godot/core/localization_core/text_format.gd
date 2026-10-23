extends RefCounted
## Text parse, formatters and culture rules of format arguments (`data` skill `### format`).

const PIECE_LITERAL: int = 0
## A format argument without a formatter: `{name}`.
const PIECE_ARGUMENT: int = 1
## A format argument with a formatter: `{name:formatter}`.
const PIECE_FORMATTED: int = 2
## An input prompt token: `{action:<action>}`.
const PIECE_PROMPT: int = 3
## Braces that are not a format argument or an input prompt token.
const PIECE_ERROR: int = 4

const _BRACE_OPEN: int = 0x7B
const _BRACE_CLOSE: int = 0x7D
const _PROMPT_PREFIX: String = "action:"

const _CULTURE_KO: int = 0
const _CULTURE_EN: int = 1
const _CULTURE_JA: int = 2
const _CULTURE_ZH_HANS: int = 3
const _CULTURE_CODES: PackedStringArray = ["ko", "en", "ja", "zh-Hans"]

const _DAY_MS: int = 86400000
const _HOUR_MS: int = 3600000
const _MINUTE_MS: int = 60000
const _SECOND_MS: int = 1000
const _INT64_MIN: int = -9223372036854775807 - 1
const _INT64_MAX: int = 9223372036854775807
## Reals at least this far from 0 are formatted from their integer part: their hundredths do not fit an int.
const _REAL_FRACTION_LIMIT: float = 9.0e16

const _PARTICLES: PackedStringArray = ["은/는", "이/가", "을/를", "와/과", "으로/로"]
## The particle after a final consonant, then the particle after none, in `_PARTICLES` order.
const _PARTICLE_FINAL: PackedStringArray = ["은", "이", "을", "과", "으로"]
const _PARTICLE_NO_FINAL: PackedStringArray = ["는", "가", "를", "와", "로"]
const _FINAL_NONE: int = 0
const _FINAL_RIEUL: int = 1
const _FINAL_OTHER: int = 2
## The final consonant of each digit read in Korean: 영, 일, 이, 삼, 사, 오, 육, 칠, 팔, 구.
const _DIGIT_FINALS: PackedInt32Array = [2, 1, 0, 2, 0, 0, 2, 1, 1, 0]

## True when the last `format_value` did not make a value: the slot is an error slot.
static var failed: bool = false


## A text split into pieces, in text order.
class Parsed extends RefCounted:
	var kinds: PackedInt32Array = PackedInt32Array()
	## Literal text, or the slot text as written. Example: `{count:n}`.
	var texts: PackedStringArray = PackedStringArray()
	## Argument name or action; empty for a literal and an error slot.
	var names: PackedStringArray = PackedStringArray()
	var formatters: PackedStringArray = PackedStringArray()

	func add(kind: int, text: String, name: String, formatter: String) -> void:
		kinds.append(kind)
		texts.append(text)
		names.append(name)
		formatters.append(formatter)

	func size() -> int:
		return kinds.size()


## Splits a text into literal text, format arguments, input prompt tokens and error slots. A `}` without its `{` is
## literal text. A `{` without its `}` makes an error slot up to the next `{` or the end of the text.
static func parse(text: String) -> Parsed:
	var parsed: Parsed = Parsed.new()
	var count: int = text.length()
	var literal_from: int = 0
	var i: int = 0
	while i < count:
		if text.unicode_at(i) != _BRACE_OPEN:
			i += 1
			continue
		if i > literal_from:
			parsed.add(PIECE_LITERAL, text.substr(literal_from, i - literal_from), "", "")
		var close: int = -1
		var j: int = i + 1
		while j < count:
			var c: int = text.unicode_at(j)
			if c == _BRACE_CLOSE:
				close = j
				break
			if c == _BRACE_OPEN:
				break
			j += 1
		if close < 0:
			parsed.add(PIECE_ERROR, text.substr(i, j - i), "", "")
			i = j
			literal_from = j
			continue
		var inner: String = text.substr(i + 1, close - i - 1)
		var raw: String = text.substr(i, close - i + 1)
		if inner.begins_with(_PROMPT_PREFIX):
			parsed.add(PIECE_PROMPT, raw, inner.substr(_PROMPT_PREFIX.length()), "")
		else:
			var colon: int = inner.find(":")
			var name: String = inner if colon < 0 else inner.substr(0, colon)
			if not _is_argument_name(name):
				parsed.add(PIECE_ERROR, raw, "", "")
			elif colon < 0:
				parsed.add(PIECE_ARGUMENT, raw, name, "")
			else:
				parsed.add(PIECE_FORMATTED, raw, name, inner.substr(colon + 1))
		i = close + 1
		literal_from = i
	if count > literal_from:
		parsed.add(PIECE_LITERAL, text.substr(literal_from), "", "")
	return parsed


## The culture rule of a language `code`: the code, then without its last subtag, and so on; `en` at the end.
static func culture_of(code: String) -> int:
	var rest: String = code
	while not rest.is_empty():
		var found: int = _CULTURE_CODES.find(rest)
		if found >= 0:
			return found
		var cut: int = rest.rfind("-")
		rest = "" if cut < 0 else rest.substr(0, cut)
	return _CULTURE_EN


## The text of one format argument. Sets `failed` when the slot is an error slot: no value, a value kind the
## formatter does not take, an unknown formatter, a NaN or infinite real, a date year out of 1 to 9999, or a
## `compact` string that is not a big integer.
static func format_value(args: FormatArgs, name: String, formatter: String, has_formatter: bool, culture: int, offset_ms: int) -> String:
	failed = false
	var kind: int = 0 if args == null else args._kind_of(name)
	if kind == FormatArgs._KIND_FLOAT:
		var real: float = args._floats[name]
		if is_nan(real) or is_inf(real):
			return _fail()
		if real == floorf(real) and absf(real) < 9.2e18:
			return _format_int(int(real), formatter, has_formatter, culture, offset_ms)
		return _format_real(real, formatter, has_formatter)
	if kind == FormatArgs._KIND_INT:
		return _format_int(args._ints[name], formatter, has_formatter, culture, offset_ms)
	if kind == FormatArgs._KIND_STRING:
		return _format_string(args._strings[name], formatter, has_formatter, culture)
	return _fail()


static func _fail() -> String:
	failed = true
	return ""


static func _format_int(raw: int, formatter: String, has_formatter: bool, culture: int, offset_ms: int) -> String:
	var value: int = _INT64_MAX if raw == _INT64_MIN else raw
	var plain: String = str(value)
	if not has_formatter:
		return plain
	if _PARTICLES.has(formatter):
		return _particle(plain, formatter)
	match formatter:
		"n":
			return _group_signed(plain)
		"compact":
			return _compact(plain, culture)
		"ordinal":
			return _ordinal(value, plain, culture)
		"duration":
			return _duration(value, culture)
		"date":
			return _date(value + offset_ms, _date_pattern(culture))
		"datetime":
			return _date(value + offset_ms, _datetime_pattern(culture))
	if formatter.begins_with("plural:"):
		return _plural(formatter, value == 1)
	return _fail()


static func _format_real(value: float, formatter: String, has_formatter: bool) -> String:
	var plain: String = _real_text(value)
	if not has_formatter:
		return plain
	if _PARTICLES.has(formatter):
		return _particle(plain, formatter)
	if formatter == "n":
		return _group_signed(plain)
	if formatter.begins_with("plural:"):
		return _plural(formatter, value == 1.0)
	return _fail()


static func _format_string(value: String, formatter: String, has_formatter: bool, culture: int) -> String:
	if not has_formatter:
		return value
	if _PARTICLES.has(formatter):
		return _particle(value, formatter)
	if formatter == "compact":
		if not UtilCore.big_is_valid(value):
			return _fail()
		return _compact(value, culture)
	return _fail()


## A real rounded at the second decimal place away from 0, without trailing zeros, the decimal point and the sign
## of 0.
static func _real_text(value: float) -> String:
	if absf(value) >= _REAL_FRACTION_LIMIT:
		return "%.0f" % value
	var hundredths: int = int(roundf(value * 100.0))
	if hundredths == 0:
		return "0"
	var magnitude: int = absi(hundredths)
	var text: String = str(magnitude / 100)
	var fraction: int = magnitude % 100
	if fraction != 0:
		var digits: String = str(fraction).pad_zeros(2)
		if digits.ends_with("0"):
			digits = digits.substr(0, 1)
		text += "." + digits
	return "-" + text if hundredths < 0 else text


## `plural:<singular>/<plural>`: the singular when the value is 1.
static func _plural(formatter: String, is_one: bool) -> String:
	var forms: String = formatter.substr("plural:".length())
	var slash: int = forms.find("/")
	if slash < 0 or forms.find("/", slash + 1) >= 0:
		return _fail()
	return forms.substr(0, slash) if is_one else forms.substr(slash + 1)


## Thousands separators on the integer part of a decimal number text with an optional `-` and fraction.
static func _group_signed(text: String) -> String:
	var negative: bool = text.begins_with("-")
	var body: String = text.substr(1) if negative else text
	var point: int = body.find(".")
	var integer: String = body if point < 0 else body.substr(0, point)
	var fraction: String = "" if point < 0 else body.substr(point)
	return ("-" if negative else "") + _group(integer) + fraction


static func _group(digits: String) -> String:
	var out: String = ""
	var count: int = digits.length()
	for i: int in range(count):
		if i > 0 and (count - i) % 3 == 0:
			out += ","
		out += digits[i]
	return out


## `compact` of a big integer text (`data` skill `### format`).
static func _compact(text: String, culture: int) -> String:
	var negative: bool = text.begins_with("-")
	var digits: String = text.substr(1) if negative else text
	var sign: String = "-" if negative else ""
	if digits == "0":
		return "0"
	var exponents: PackedInt32Array = _compact_exponents(culture)
	var labels: PackedStringArray = _compact_labels(culture)
	var unit: int = -1
	for u: int in range(exponents.size()):
		if exponents[u] <= digits.length() - 1:
			unit = u
	if unit < 0:
		return sign + _group(digits)
	var integer_length: int = digits.length() - exponents[unit]
	if unit == exponents.size() - 1 and integer_length >= 5:
		return sign + _three_digits(digits, 1) + "e" + str(digits.length() - 1)
	return sign + _three_digits(digits, integer_length) + labels[unit]


## `digits` with the decimal point after `integer_length` digits, cut toward 0 to 3 significant digits when the
## integer part is shorter, without trailing zeros and the decimal point.
static func _three_digits(digits: String, integer_length: int) -> String:
	var integer: String = digits.substr(0, integer_length)
	var fraction_end: int = maxi(integer_length, 3)
	var fraction: String = digits.substr(integer_length, fraction_end - integer_length)
	while fraction.ends_with("0"):
		fraction = fraction.substr(0, fraction.length() - 1)
	return integer if fraction == "" else integer + "." + fraction


static func _compact_exponents(culture: int) -> PackedInt32Array:
	match culture:
		_CULTURE_KO, _CULTURE_JA:
			return PackedInt32Array([4, 8, 12, 16])
		_CULTURE_ZH_HANS:
			return PackedInt32Array([4, 8, 12])
	return PackedInt32Array([3, 6, 9, 12])


static func _compact_labels(culture: int) -> PackedStringArray:
	match culture:
		_CULTURE_KO:
			return PackedStringArray(["만", "억", "조", "경"])
		_CULTURE_JA:
			return PackedStringArray(["万", "億", "兆", "京"])
		_CULTURE_ZH_HANS:
			return PackedStringArray(["万", "亿", "万亿"])
	return PackedStringArray(["K", "M", "B", "T"])


static func _ordinal(value: int, plain: String, culture: int) -> String:
	match culture:
		_CULTURE_KO:
			return plain + "번째"
		_CULTURE_JA:
			return plain + "番目"
		_CULTURE_ZH_HANS:
			return "第" + plain
	var magnitude: int = absi(value)
	var last_two: int = magnitude % 100
	if last_two >= 11 and last_two <= 13:
		return plain + "th"
	match magnitude % 10:
		1:
			return plain + "st"
		2:
			return plain + "nd"
		3:
			return plain + "rd"
	return plain + "th"


static func _duration(value: int, culture: int) -> String:
	var units: PackedStringArray = _duration_units(culture)
	var magnitude: int = absi(value)
	var parts: PackedInt64Array = PackedInt64Array([
		magnitude / _DAY_MS,
		(magnitude % _DAY_MS) / _HOUR_MS,
		(magnitude % _HOUR_MS) / _MINUTE_MS,
		(magnitude % _MINUTE_MS) / _SECOND_MS,
	])
	var first: int = -1
	for i: int in range(parts.size()):
		if parts[i] != 0:
			first = i
			break
	if first < 0:
		return "0" + units[3]
	var text: String = str(parts[first]) + units[first]
	if first + 1 < parts.size() and parts[first + 1] != 0:
		text += " " + str(parts[first + 1]) + units[first + 1]
	return "-" + text if value < 0 else text


static func _duration_units(culture: int) -> PackedStringArray:
	match culture:
		_CULTURE_KO:
			return PackedStringArray(["일", "시간", "분", "초"])
		_CULTURE_JA:
			return PackedStringArray(["日", "時間", "分", "秒"])
		_CULTURE_ZH_HANS:
			return PackedStringArray(["天", "小时", "分钟", "秒"])
	return PackedStringArray(["d", "h", "m", "s"])


static func _date_pattern(culture: int) -> String:
	match culture:
		_CULTURE_KO:
			return "yyyy.MM.dd"
		_CULTURE_JA:
			return "yyyy/MM/dd"
		_CULTURE_ZH_HANS:
			return "yyyy/M/d"
	return "MM/dd/yyyy"


static func _datetime_pattern(culture: int) -> String:
	return _date_pattern(culture) + " HH:mm"


## The pattern filled with the proleptic Gregorian date of a local time in Unix ms; an error slot when the year is
## not 1 to 9999.
static func _date(local_ms: int, pattern: String) -> String:
	var days: int = UtilCore.floor_div(local_ms, _DAY_MS)
	var in_day: int = local_ms - days * _DAY_MS
	# Days from civil, inverted.
	var z: int = days + 719468
	var era: int = UtilCore.floor_div(z, 146097)
	var day_of_era: int = z - era * 146097
	var year_of_era: int = (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146096) / 365
	var day_of_year: int = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100)
	var shifted_month: int = (5 * day_of_year + 2) / 153
	var day: int = day_of_year - (153 * shifted_month + 2) / 5 + 1
	var month: int = shifted_month + 3 if shifted_month < 10 else shifted_month - 9
	var year: int = year_of_era + era * 400 + (1 if month <= 2 else 0)
	if year < 1 or year > 9999:
		return _fail()
	var out: String = ""
	var i: int = 0
	while i < pattern.length():
		if pattern.substr(i, 4) == "yyyy":
			out += str(year).pad_zeros(4)
			i += 4
		elif pattern.substr(i, 2) == "MM":
			out += str(month).pad_zeros(2)
			i += 2
		elif pattern.substr(i, 2) == "dd":
			out += str(day).pad_zeros(2)
			i += 2
		elif pattern.substr(i, 2) == "HH":
			out += str(in_day / _HOUR_MS).pad_zeros(2)
			i += 2
		elif pattern.substr(i, 2) == "mm":
			out += str((in_day % _HOUR_MS) / _MINUTE_MS).pad_zeros(2)
			i += 2
		elif pattern[i] == "M":
			out += str(month)
			i += 1
		elif pattern[i] == "d":
			out += str(day)
			i += 1
		else:
			out += pattern[i]
			i += 1
	return out


## The value text with the Korean particle the final consonant of its last character picks.
static func _particle(text: String, formatter: String) -> String:
	var index: int = _PARTICLES.find(formatter)
	var final: int = _final_consonant(text)
	if formatter == "으로/로":
		return text + (_PARTICLE_FINAL[index] if final == _FINAL_OTHER else _PARTICLE_NO_FINAL[index])
	return text + (_PARTICLE_NO_FINAL[index] if final == _FINAL_NONE else _PARTICLE_FINAL[index])


## The final consonant of the last character as read in Korean. A digit reads as its Korean name, a Latin letter
## as its Korean letter name, where only L, M, N and R have one. Other characters and the empty text have none.
static func _final_consonant(text: String) -> int:
	if text.is_empty():
		return _FINAL_NONE
	var code: int = text.unicode_at(text.length() - 1)
	if code >= 0xAC00 and code <= 0xD7A3:
		var final: int = (code - 0xAC00) % 28
		if final == 0:
			return _FINAL_NONE
		return _FINAL_RIEUL if final == 8 else _FINAL_OTHER
	if code >= 0x30 and code <= 0x39:
		return _DIGIT_FINALS[code - 0x30]
	var letter: int = code - 0x20 if code >= 0x61 and code <= 0x7A else code
	if letter == 0x4C or letter == 0x52:
		return _FINAL_RIEUL
	if letter == 0x4D or letter == 0x4E:
		return _FINAL_OTHER
	return _FINAL_NONE


## An argument name: one or more ASCII letters, digits and `_`.
static func _is_argument_name(name: String) -> bool:
	if name.is_empty():
		return false
	for i: int in range(name.length()):
		var c: int = name.unicode_at(i)
		var letter: bool = (c >= 0x41 and c <= 0x5A) or (c >= 0x61 and c <= 0x7A)
		if not letter and not (c >= 0x30 and c <= 0x39) and c != 0x5F:
			return false
	return true
