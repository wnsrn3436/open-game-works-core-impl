extends Node
## Core node of `ResolutionCore`: the root window `size_changed` and `titlebar_changed` connections, the frame check
## of a screen mode transition, and the fill area view. The fill area is two bands, each a clipping `Control` that
## holds the fill color and its part of the fill image.

const _BAND_COUNT: int = 2

var _layer: CanvasLayer = null
var _bands: Array[Control] = []
var _colors: Array[ColorRect] = []
var _images: Array[TextureRect] = []


## Processes in a paused tree too: the end of a screen mode transition does not wait for the pause to end.
func _init() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


## Builds the fill area view: a top canvas layer with two hidden bands.
func setup() -> void:
	_layer = CanvasLayer.new()
	_layer.name = "Fill"
	_layer.layer = RenderingServer.CANVAS_LAYER_MAX
	add_child(_layer)
	for i: int in _BAND_COUNT:
		var band: Control = Control.new()
		band.name = "Band%d" % i
		band.clip_contents = true
		band.mouse_filter = Control.MOUSE_FILTER_IGNORE
		band.visible = false
		var color: ColorRect = ColorRect.new()
		color.mouse_filter = Control.MOUSE_FILTER_IGNORE
		band.add_child(color)
		var image: TextureRect = TextureRect.new()
		image.mouse_filter = Control.MOUSE_FILTER_IGNORE
		image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		image.stretch_mode = TextureRect.STRETCH_SCALE
		image.visible = false
		band.add_child(image)
		_layer.add_child(band)
		_bands.append(band)
		_colors.append(color)
		_images.append(image)


## Places the fill bands in the window area: on both sides of the game area, or above and below it. `has_fill`
## false hides them. The fill image keeps its aspect, covers the whole window area at the smallest size, and sits
## at the window area center; each band shows the part over it.
func layout_fill(area: Vector2i, game_area: Rect2, has_fill: bool, color: Color, texture: Texture2D) -> void:
	if _bands.size() != _BAND_COUNT:
		return
	if not has_fill:
		for band: Control in _bands:
			band.visible = false
		return
	var rects: Array[Rect2] = []
	if game_area.position.x > 0.0:
		var right: float = game_area.position.x + game_area.size.x
		rects.append(Rect2(0.0, 0.0, game_area.position.x, area.y))
		rects.append(Rect2(right, 0.0, area.x - right, area.y))
	else:
		var bottom: float = game_area.position.y + game_area.size.y
		rects.append(Rect2(0.0, 0.0, area.x, game_area.position.y))
		rects.append(Rect2(0.0, bottom, area.x, area.y - bottom))
	var image_rect: Rect2 = Rect2()
	var texture_size: Vector2 = Vector2.ZERO if texture == null else texture.get_size()
	var has_image: bool = texture_size.x > 0.0 and texture_size.y > 0.0
	if has_image:
		var cover: float = maxf(area.x / texture_size.x, area.y / texture_size.y)
		var size: Vector2 = texture_size * cover
		image_rect = Rect2((Vector2(area) - size) / 2.0, size)
	for i: int in _BAND_COUNT:
		var band: Control = _bands[i]
		band.position = rects[i].position
		band.size = rects[i].size
		band.visible = true
		_colors[i].position = Vector2.ZERO
		_colors[i].size = rects[i].size
		_colors[i].color = color
		var image: TextureRect = _images[i]
		image.texture = texture if has_image else null
		image.visible = has_image
		if has_image:
			image.position = image_rect.position - rects[i].position
			image.size = image_rect.size


## Processes only during a screen mode transition.
func _ready() -> void:
	set_process(false)


func _process(_delta: float) -> void:
	ResolutionCore._on_transition_frame()


func _on_size_changed() -> void:
	ResolutionCore._on_window_size_changed()


func _on_titlebar_changed() -> void:
	ResolutionCore._on_window_titlebar_changed()


func _exit_tree() -> void:
	ResolutionCore._on_core_node_exit(self)
