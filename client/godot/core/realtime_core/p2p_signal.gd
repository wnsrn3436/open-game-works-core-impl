extends RefCounted
## One offer, answer or ICE candidate of the P2P transport: the UTF-8 JSON `payload` of a `PEER_SIGNAL`.

enum Type { OFFER, ANSWER, CANDIDATE }

const _CANDIDATE_LINE: String = "a=candidate:"
## 2^53: `attempt` and `index` are below it.
const _INTEGER_END: int = 9007199254740992
const _NUMBER_END: float = 9007199254740992.0

var type: Type = Type.OFFER
## Connection attempt number: the offering side counts its new connections to a participant from 1, and the answer and
## the candidates carry the number of the offer they belong to.
var attempt: int = 0
## SDP of an offer or an answer; the candidate string of an ICE candidate.
var data: String = ""
## Media stream ID of an ICE candidate.
var mid: String = ""
## m-line index of an ICE candidate.
var index: int = 0


## The `PEER_SIGNAL` `payload` bytes.
func to_payload() -> PackedByteArray:
	var text: String = ""
	match type:
		Type.OFFER:
			text = '{"type":"offer","attempt":%d,"data":%s}' % [attempt, JSON.stringify(data)]
		Type.ANSWER:
			text = '{"type":"answer","attempt":%d,"data":%s}' % [attempt, JSON.stringify(data)]
		Type.CANDIDATE:
			text = '{"type":"candidate","attempt":%d,"data":%s,"mid":%s,"index":%d}' % [
				attempt, JSON.stringify(data), JSON.stringify(mid), index
			]
	return text.to_utf8_buffer()


## Reads a `payload`. Returns `false` for a malformed `payload`: not a JSON object, a `type` other than `offer`,
## `answer` and `candidate`, an `attempt` that is not an integer of 1 or more and below 2^53, a `data` that is not a
## string, or a candidate whose `mid` is not a string or whose `index` is not an integer of 0 or more and below 2^53.
# ogw:input_boundary
func read(payload: PackedByteArray) -> bool:
	var parsed: Variant = JSON.parse_string(payload.get_string_from_utf8())
	if not (parsed is Dictionary):
		return false
	var object: Dictionary = parsed
	var raw_type: Variant = object["type"] if object.has("type") else null
	var raw_data: Variant = object["data"] if object.has("data") else null
	if not (raw_type is String) or not (raw_data is String):
		return false
	var type_text: String = raw_type
	data = raw_data
	attempt = _integer(object["attempt"] if object.has("attempt") else null)
	if attempt < 1:
		return false
	match type_text:
		"offer":
			type = Type.OFFER
		"answer":
			type = Type.ANSWER
		"candidate":
			type = Type.CANDIDATE
			var raw_mid: Variant = object["mid"] if object.has("mid") else null
			var raw_index: Variant = object["index"] if object.has("index") else null
			if not (raw_mid is String):
				return false
			mid = raw_mid
			index = _integer(raw_index)
			if index < 0:
				return false
		_:
			return false
	return true


## The integer a JSON value holds; -1 when it holds no integer of 0 or more and below 2^53, the integers every
## runtime's JSON reads exactly.
# ogw:input_boundary
static func _integer(value: Variant) -> int:
	var number: int = -1
	if value is int:
		number = value
	elif value is float:
		var real: float = value
		if is_nan(real) or is_inf(real) or real != floorf(real) or real < 0.0 or real >= _NUMBER_END:
			return -1
		number = int(real)
	return number if number >= 0 and number < _INTEGER_END else -1


## `sdp` without the `a=candidate:` lines whose candidate type is not `relay`.
static func relay_sdp(sdp: String) -> String:
	var kept: PackedStringArray = PackedStringArray()
	for line: String in sdp.split("\n"):
		var text: String = line.strip_edges()
		if text.begins_with(_CANDIDATE_LINE) and not is_relay_candidate(text):
			continue
		kept.append(line)
	return "\n".join(kept)


## Whether the candidate type of a candidate string, the token after `typ`, is `relay`.
static func is_relay_candidate(candidate: String) -> bool:
	var tokens: PackedStringArray = candidate.strip_edges().split(" ", false)
	for i: int in tokens.size() - 1:
		if tokens[i] == "typ":
			return tokens[i + 1] == "relay"
	return false
