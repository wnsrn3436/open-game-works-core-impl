class_name ItemAddPreviewReplacement
extends RefCounted
## One `Convert` replacement grant of an `ItemAddPreviewRow`. Amounts are contract big encoding pairs.

## Replacement item ID value.
var item_id: int = 0
## The amount that goes into the replacement item.
var applied: int = 0
var big_applied: String = ""
## The amount `max_amount` keeps out of the replacement item.
var overflow: int = 0
var big_overflow: String = ""
