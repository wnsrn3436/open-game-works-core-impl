class_name RealtimeCoreDev
extends RefCounted
## DEV operations of `RealtimeCore`.

const _TAG: String = "RealtimeCore"


## Closes the connection with a `Connected` participant in `Playing` without a leave notice.
static func force_peer_lost(participant: int) -> bool:
	if not RealtimeCore._check("force_peer_lost"):
		return false
	if RealtimeCore._state != RealtimeCore.MatchState.PLAYING or not RealtimeCore._is_other_participant(participant):
		LogCore.log_warn(_TAG, "force_peer_lost: not Playing, or not another participant")
		return false
	if RealtimeCore._peer_states[participant] != RealtimeCore.PeerState.CONNECTED:
		LogCore.log_warn(_TAG, "force_peer_lost: the participant is not Connected")
		return false
	_force_close_peer(RealtimeCore._transport, participant)
	return true


## Closes the matchmaker connection in `Playing` without `MATCH_LEAVE`.
static func force_matchmaker_lost() -> bool:
	if not RealtimeCore._check("force_matchmaker_lost"):
		return false
	if RealtimeCore._state != RealtimeCore.MatchState.PLAYING:
		LogCore.log_warn(_TAG, "force_matchmaker_lost: the match is not Playing")
		return false
	_force_close_matchmaker(RealtimeCore._transport)
	return true


## Asks the lockstep transport for a step of `ms` and waits until this participant finishes it.
static func request_step(ms: int) -> bool:
	if not RealtimeCore._check("request_step"):
		return false
	if RealtimeCore._state != RealtimeCore.MatchState.PLAYING:
		LogCore.log_warn(_TAG, "request_step: the match is not Playing")
		return false
	var transport: RealtimeTransport = RealtimeCore._transport
	if not (transport is LockstepRealtimeTransport):
		LogCore.log_warn(_TAG, "request_step: the transport is not a lockstep transport")
		return false
	var lockstep: LockstepRealtimeTransport = transport as LockstepRealtimeTransport
	return await lockstep.request_step(ms)


## The transport DEV operation `force_close_peer` of `transport`. The P2P transport has no DEV operation, so it is done
## here on its connections: STG and PROD builds have no code that closes them this way.
static func _force_close_peer(transport: RealtimeTransport, participant: int) -> void:
	if transport is RealtimeDevTransport:
		(transport as RealtimeDevTransport).force_close_peer(participant)
	elif transport is P2pRealtimeTransport:
		_close_p2p_peer(transport as P2pRealtimeTransport, participant)


## The transport DEV operation `force_close_matchmaker` of `transport`.
static func _force_close_matchmaker(transport: RealtimeTransport) -> void:
	if transport is RealtimeDevTransport:
		(transport as RealtimeDevTransport).force_close_matchmaker()
	elif transport is P2pRealtimeTransport:
		_close_p2p_matchmaker(transport as P2pRealtimeTransport)


## Closes the WebRTC connection of a participant without a leave notice. The next `poll` adds its peer lost.
static func _close_p2p_peer(p2p: P2pRealtimeTransport, participant: int) -> void:
	if participant < 0 or participant >= p2p._peers.size() or p2p._peers[participant] == null:
		return
	var connection: WebRTCPeerConnection = p2p._peers[participant].connection
	if connection != null:
		connection.close()


## Closes the matchmaker connection without `MATCH_LEAVE`. The next `poll` adds a matchmaker lost.
static func _close_p2p_matchmaker(p2p: P2pRealtimeTransport) -> void:
	if p2p._socket != null:
		p2p._drop_socket(0)
