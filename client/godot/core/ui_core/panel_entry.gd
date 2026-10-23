extends RefCounted
## One panel stack item. Only the top item has a panel instance.

var key: String = ""
var param: UIParam = null
var cache: UIPanelCache = null
## The item was shown at least once.
var shown: bool = false
## Put by `open_root_panel`. At most one, at the bottom.
var root: bool = false
