extends RefCounted
## Whether a frame was drawn since this was made: `on_drawn` is connected to `RenderingServer.frame_post_draw`.

var drawn: bool = false


func on_drawn() -> void:
	drawn = true
