class_name ChatMessagesChangedEvent
extends EventBase
## ChatCore event: the cache of a watched channel changed.

var channel_kind: CoreContract.ChatChannelKind = CoreContract.ChatChannelKind.CHAT_CHANNEL_KIND_UNSPECIFIED
## Channel key of the operations: the channel number for `World`, 0 for `Guild`, the other user ID for `Direct`.
var channel_key: int = 0
var change: ChatCore.ChatMessagesChange = ChatCore.ChatMessagesChange.RESET
## Number of the messages that changed: the cache size for `RESET`.
var count: int = 0
