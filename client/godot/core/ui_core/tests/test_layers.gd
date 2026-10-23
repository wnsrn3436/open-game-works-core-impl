extends "res://core/ui_core/tests/support/ui_test_case.gd"
## UI layers: the drawing order, pointer input from the top and the camera.


func test_layer_order() -> void:
	assert_true(await start())
	var previous: int = 0
	for layer: int in UICore.UILayer.size():
		var canvas: CanvasLayer = UICore.get_layer(layer)
		assert_not_null(canvas)
		assert_true(canvas.layer > previous, "drawn above the layer before")
		previous = canvas.layer


func test_upper_layer_takes_the_pointer() -> void:
	assert_true(await start())
	var lower: Button = add_button(UICore.UILayer.SCENE_UI, "lower", Vector2(500, 300))
	var upper: Button = add_button(UICore.UILayer.MESSAGE, "upper", Vector2(500, 300))
	await UnitTestCore.wait_frames(1)
	await tap_control(upper)
	assert_eq(clicks, PackedStringArray(["upper"]), "the lower layer does not take it")


func test_camera_shake_does_not_move_ui() -> void:
	assert_true(await start())
	var button: Button = add_button(UICore.UILayer.SCENE_UI, "ui", Vector2(500, 300))
	await UnitTestCore.wait_frames(1)
	var before: Vector2 = button.get_global_transform_with_canvas().origin
	var camera: Camera2D = Camera2D.new()
	add_child_autofree(camera)
	camera.make_current()
	camera.offset = Vector2(37, -21)
	await UnitTestCore.wait_frames(2)
	assert_eq(button.get_global_transform_with_canvas().origin, before)
