extends RefCounted
## One watched channel of ChatCore: its message cache, cursors and poll state.

const _WAIT := preload("res://core/chat_core/chat_wait.gd")

var kind: CoreContract.ChatChannelKind = CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_UNSPECIFIED
## Channel key of the operations.
var key: int = 0
## Messages in ascending seq.
var messages: Array[CoreContract.ChatMessage] = []
var new_cursor: int = 0
var old_cursor: int = 0
var delete_cursor: int = 0
## `Guild`: the guild ID of the last response. 0 before the first response.
var guild_id: int = 0
## The first request succeeded.
var first_done: bool = false
## Raised when the cache and cursors go back to the start: results of requests sent before are dropped.
var epoch: int = 0
## A `GetChatMessages` poll is on the way.
var busy: bool = false
## Real elapsed time at which the next poll goes; -1 while a poll is on the way.
var due_at: int = -1
## Send the next poll right after the one on the way.
var kick: bool = false
## A `load_older` request is on the way.
var older_busy: bool = false
## Waits of the `load_older` calls that share the request on the way.
var older_waits: Array[_WAIT] = []


func max_seq() -> int:
	return messages[messages.size() - 1].seq if not messages.is_empty() else 0


func min_seq() -> int:
	return messages[0].seq if not messages.is_empty() else 0


## Back to the start: no cache, cursors 0.
func reset() -> void:
	messages = []
	new_cursor = 0
	old_cursor = 0
	delete_cursor = 0
	guild_id = 0
	first_done = false
	epoch += 1
