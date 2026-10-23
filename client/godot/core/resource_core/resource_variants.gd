class_name ResourceVariants
extends Resource
## Resource list of a resource key with two or more variants. `ResourceCore.load` and `ResourceCore.get_loaded` return
## it for such a key. `items` are in variant order from variant 1.

var items: Array[Resource] = []
