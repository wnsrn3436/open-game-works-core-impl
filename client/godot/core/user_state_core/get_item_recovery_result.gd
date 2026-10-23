class_name GetItemRecoveryResult
extends RefCounted
## Output of `UserStateCore.get_item_recovery`. Both are 0 when the item is not recovering.

## Next recovery time, Unix ms.
var next_at: int = 0
## Time the balance reaches the recovery cap, Unix ms.
var cap_at: int = 0
