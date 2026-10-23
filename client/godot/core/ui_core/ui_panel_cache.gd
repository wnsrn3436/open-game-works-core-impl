class_name UIPanelCache
extends RefCounted
## Base of the cache classes of panels. Content code extends it. A panel puts its cache in `UIPanel.cache`; `UICore`
## keeps it in the panel stack item when the panel is covered and hands it back in `UIPanel.prepare`. A cache refers
## to no engine object and no resource; a callback is the one exception.
