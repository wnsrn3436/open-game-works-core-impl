extends RefCounted
## A `PEER_SIGNAL` the P2P transport received before `connect_peer` of its participant index.

const _SIGNAL := preload("res://core/realtime_core/p2p_signal.gd")

var participant: int = 0
var received: _SIGNAL = null
