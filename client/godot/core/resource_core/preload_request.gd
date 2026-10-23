class_name PreloadRequest
extends RefCounted
## Items `ResourceCore.preload_resources` loads, and its progress. The caller adds the items before the preload and
## does not change them during it.


## One item: a resource key, the resource kind to load it as, and whether to warm up its shaders.
class Item:
	extends RefCounted

	var key: String = ""
	var kind: int = ResourceCore.INVALID_KIND
	var shader_warmup: bool = false


var items: Array[Item] = []
## Items the running or last preload finished, failed ones included.
var done_count: int = 0
## Items of the running or last preload.
var total_count: int = 0


## Adds an item at the end of `items`.
func add_item(key: String, kind: int, shader_warmup: bool = false) -> void:
	var item: Item = Item.new()
	item.key = key
	item.kind = kind
	item.shader_warmup = shader_warmup
	items.append(item)
	total_count = items.size()
