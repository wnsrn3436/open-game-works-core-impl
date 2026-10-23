class_name BadgeChangedEvent
extends EventBase
## BadgeCore event: at the frame end, the total count of a badge or the count of an item badge changed.

## Badge ID value of the data badge.
var badge_id: int = 0
## Item key of the item badge. 0 when the event is about the badge itself.
var item_key: int = 0
## The new total count of the badge, or the new count of the item badge.
var count: int = 0
