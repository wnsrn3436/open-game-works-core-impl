class_name ItemAddPreviewRow
extends RefCounted
## One row of `UserStateCore.preview_item_add`: what a grant of one item would do, as server `item-ledger`
## `preview_add_items` computes it. Amounts are contract big encoding pairs.

## Item ID value.
var item_id: int = 0
var outcome: UserStateCore.ItemAddPreview = UserStateCore.ItemAddPreview.APPLIED
## The amount that goes into the item. A timed item counts in `duration`s.
var applied: int = 0
var big_applied: String = ""
## The amount `max_amount` keeps out of the item.
var overflow: int = 0
var big_overflow: String = ""
## The `Convert` replacement grants, in `convert_to` order. Empty when the item is not `Convert` or nothing overflows.
var replacements: Array[ItemAddPreviewReplacement] = []
