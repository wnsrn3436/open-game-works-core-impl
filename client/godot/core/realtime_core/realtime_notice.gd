class_name RealtimeNotice
extends RefCounted
## One transport notification of a `RealtimeTransport` and its payload. Only the fields of `kind` are filled.

enum Kind {
	MATCH_FOUND,
	MATCH_FAILED,
	MATCHMAKER_LOST,
	REJOINED,
	PEER_CONNECTED,
	PEER_LOST,
	PACKET_RECEIVED,
	ROOM_UPDATED,
	ROOM_FAILED,
	ROOM_KICKED,
}

var kind: Kind = Kind.MATCH_FOUND
## Match found: the `MatchInfo`.
var match_info: MatchInfo = null
## Match failed: the `MatchFailReason`.
var fail_reason: CoreContract.MatchFailReason = CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED
## Match failed, room failed: the error code. Matchmaker lost: the `code` of `CLOSE`; without it the decimal reason of
## close code 4000, else 0.
var error_code: int = 0
## Rejoined: the success flag.
var ok: bool = false
## Rejoined: the indices of the participants that left.
var left_indices: PackedInt32Array = PackedInt32Array()
## Peer connected, peer lost, packet received: the participant index.
var participant: int = 0
## Packet received: the channel.
var channel: RealtimeCore.RealtimeChannel = RealtimeCore.RealtimeChannel.RELIABLE
## Packet received: the packet.
var packet: PackedByteArray = PackedByteArray()
## Room updated: the `RoomInfo`.
var room_info: RoomInfo = null
## Room failed: the request that failed.
var room_request: RealtimeCore.RoomRequest = RealtimeCore.RoomRequest.OPEN


## Puts every payload field back to its default and sets `kind`. Keeps the packet buffer for reuse.
func reset(notice_kind: Kind) -> void:
	kind = notice_kind
	match_info = null
	fail_reason = CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED
	error_code = 0
	ok = false
	left_indices.resize(0)
	participant = 0
	channel = RealtimeCore.RealtimeChannel.RELIABLE
	packet.resize(0)
	room_info = null
	room_request = RealtimeCore.RoomRequest.OPEN


## Puts the kind and the payload of `source` into this notice.
func copy_from(source: RealtimeNotice) -> void:
	kind = source.kind
	match_info = source.match_info
	fail_reason = source.fail_reason
	error_code = source.error_code
	ok = source.ok
	left_indices = source.left_indices.duplicate()
	participant = source.participant
	channel = source.channel
	packet = source.packet
	room_info = source.room_info
	room_request = source.room_request
