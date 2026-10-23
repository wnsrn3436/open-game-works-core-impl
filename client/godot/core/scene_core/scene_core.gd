class_name SceneCore
extends RefCounted
## Changes the scene on screen to another scene: the transition, the loading screen meanwhile and the retry popup of a
## failed scene prepare.

const _TAG: String = "SceneCore"
const _LOADING_SCREEN_KEY: String = "loadingScreen"
const _MIN_DISPLAY_KEY: String = "SceneCore.loadingMinDisplayMs"
const _RETRY_COUNT_KEY: String = "SceneCore.prepareRetryCount"
const _REASON: String = "scene"
const _CORE_NODE := preload("res://core/scene_core/scene_core_node.gd")
const _JOB := preload("res://core/scene_core/transition_job.gd")
const _POPUP_WAIT := preload("res://core/scene_core/popup_wait.gd")
const _WAIT := preload("res://core/scene_core/transition_wait.gd")

# Answers to the retry popup.
const _OUTCOME_NONE: int = 0
const _OUTCOME_RETRY: int = 1
const _OUTCOME_RESTART: int = 2
const _OUTCOME_CLOSED: int = 3
const _OUTCOME_NOT_OPENED: int = 4

static var _is_initialized: bool = false
## Replaced by every `init`; a transition that sees another session after `await` stops without changing the state.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
## Scene holder: the parent of the scene from stage 4 until it is destroyed.
static var _holder: Node = null
## Safe area root of the `SceneUI` layer: the parent of the scene UI root.
static var _scene_ui_area: SafeAreaRoot = null
## Safe area root of the `Loading` layer: the parent of the loading screen.
static var _loading_area: SafeAreaRoot = null
static var _loading_screen_key: String = ""
static var _min_display_ms: int = 0
static var _retry_count: int = 0

# The current scene. None before the first transition, from stage 3 until stage 7 and after `release`.
static var _scene: SceneBase = null
static var _scene_key: String = ""
static var _scope: Scope = null
static var _root_panel: String = ""
## The scene UI root of the current scene, moved under `_scene_ui_area`. null: none.
static var _ui_root: Control = null
## The scene made in stage 4, until stage 7 makes it the current scene.
static var _new_scene: SceneBase = null

## `boot_change_scene` succeeded once since `init`.
static var _booted: bool = false
static var _transitioning: bool = false
## Scene key of the running transition.
static var _transition_key: String = ""
static var _job: _JOB = null
## Block token of the transition block. 0: no transition block.
static var _block_token: int = 0

static var _loading_screen: LoadingScreenBase = null
static var _loading_shown: bool = false
## Real elapsed time when the loading screen was shown.
static var _shown_at: int = 0

## From stage 4 until stage 7 the top visual nodes under the scene holder are hidden; `_hidden` keeps them.
static var _hiding: bool = false
static var _hidden: Array[Node] = []

# Progress of the transition: tasks ended and all tasks. `_progress_total` is 0 until `on_preload` returns.
static var _progress_done: int = 0
static var _progress_total: int = 0
static var _progress_last: int = 0

static var _deadline: int = 0
static var _deadline_wait: _WAIT = null
static var _preload_wait: _WAIT = null

static var _popup_wait: _POPUP_WAIT = null
## The param of the last retry popup.
static var _popup_param: SystemPopupParam = null


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_string(_LOADING_SCREEN_KEY):
		LogCore.log_error(_TAG, "init: game settings loadingScreen is missing or not a string")
		return false
	if not CoreSettings.has_int(_MIN_DISPLAY_KEY):
		LogCore.log_error(_TAG, "init: core settings key SceneCore.loadingMinDisplayMs is missing or not an integer")
		return false
	if not CoreSettings.has_int(_RETRY_COUNT_KEY):
		LogCore.log_error(_TAG, "init: core settings key SceneCore.prepareRetryCount is missing or not an integer")
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: the main loop is not a SceneTree")
		return false
	var scene_layer: Node = UICore.get_layer(UICore.UILayer.SCENE_UI)
	var loading_layer: Node = UICore.get_layer(UICore.UILayer.LOADING)
	if scene_layer == null or loading_layer == null:
		LogCore.log_error(_TAG, "init: UICore gave no SceneUI or Loading layer")
		return false
	_loading_screen_key = CoreSettings.get_string(_LOADING_SCREEN_KEY)
	_min_display_ms = CoreSettings.get_int(_MIN_DISPLAY_KEY)
	_retry_count = CoreSettings.get_int(_RETRY_COUNT_KEY)
	_session = RefCounted.new()
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	var holder: Node = Node.new()
	holder.name = "SceneHolder"
	var scene_ui_area: SafeAreaRoot = SafeAreaRoot.new()
	scene_ui_area.name = "SceneCoreSafeArea"
	var loading_area: SafeAreaRoot = SafeAreaRoot.new()
	loading_area.name = "SceneCoreSafeArea"
	_node = node
	_holder = holder
	_scene_ui_area = scene_ui_area
	_loading_area = loading_area
	_is_initialized = true
	tree.root.add_child(node)
	tree.root.add_child(holder)
	scene_layer.add_child(scene_ui_area)
	loading_layer.add_child(loading_area)
	if tree.node_added.connect(node.on_node_added) != OK:
		LogCore.log_error(_TAG, "init: could not connect SceneTree.node_added")
		release()
		return false
	if not EventCore.subscribe(SafeAreaChangedEvent, node._on_safe_area_changed):
		LogCore.log_error(_TAG, "init: could not subscribe to SafeAreaChangedEvent")
		release()
		return false
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: _CORE_NODE = _node
	_disconnect(node)
	_end_state(true)
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Async operation. Changes the current scene to the scene of `scene_key`. `scene_param` (null: none) goes to the new
## scene; the caller does not change it afterwards.
static func change_scene(scene_key: String, scene_param: RefCounted) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "change_scene: not initialized")
		return false
	if _transitioning:
		LogCore.log_warn(_TAG, "change_scene: in transition. requested=%s running=%s" % [scene_key, _transition_key])
		return false
	if not _booted:
		LogCore.log_error(_TAG, "change_scene: boot_change_scene has not succeeded. requested=" + scene_key)
		return false
	return await _start(scene_key, scene_param, false)


## Async operation. `change_scene` of the boot: no loading screen, no minimum display time and no retry popup.
static func boot_change_scene(scene_key: String, scene_param: RefCounted) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "boot_change_scene: not initialized")
		return false
	if _transitioning:
		LogCore.log_warn(_TAG, "boot_change_scene: in transition. requested=%s running=%s" % [scene_key, _transition_key])
		return false
	return await _start(scene_key, scene_param, true)


static func current_scene_key() -> String:
	if not _is_initialized:
		LogCore.log_error(_TAG, "current_scene_key: not initialized")
		return ""
	return _scene_key


## Resource scope of the current scene. null when there is no current scene.
static func current_scope() -> Scope:
	if not _is_initialized:
		LogCore.log_error(_TAG, "current_scope: not initialized")
		return null
	return _scope


static func current_root_panel_key() -> String:
	if not _is_initialized:
		LogCore.log_error(_TAG, "current_root_panel_key: not initialized")
		return ""
	return _root_panel


static func is_transitioning() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_transitioning: not initialized")
		return false
	return _transitioning


static func _start(scene_key: String, scene_param: RefCounted, boot: bool) -> bool:
	var job: _JOB = _JOB.new()
	_job = job
	_transitioning = true
	_transition_key = scene_key
	_run(job, scene_key, scene_param, boot)
	if not job.done:
		await job.finished
	return job.result


# The stages of one transition. Every `await` is followed by a session check: after `release` the transition stops
# without changing the state, and `release` already ended `job`.
static func _run(job: _JOB, key: String, param: RefCounted, boot: bool) -> void:
	var session: RefCounted = _session
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var started_at: int = TimeCore.get_real_time()

	# 1 begin
	_block_token = InputBlockCore.block(_REASON, UICore.get_block_pass_list())
	if _block_token == 0:
		_fail(job, "transition block could not be put. scene=" + key)
		return
	MessageCore.close_black_box()
	InputBlockCore.release_all(_REASON)
	UICore.set_panel_lock(true)
	UICore.close_all_popups()
	if session != _session:
		return
	if not boot:
		await _show_loading_screen(session, key)
		if session != _session:
			return

	# 2 exit
	if is_instance_valid(_scene):
		var ending: SceneBase = _scene
		var ending_key: String = _scene_key
		ending.on_exit()
		if session != _session:
			return
		var ended: SceneEndedEvent = EventCore.acquire(SceneEndedEvent) as SceneEndedEvent
		if ended != null:
			ended.scene_key = ending_key
			EventCore.publish(ended)
		if session != _session:
			return

	# 3 unload
	UICore.reset_panel_stack()
	var old_scene: SceneBase = _scene
	var old_ui_root: Control = _ui_root
	var old_scope: Scope = _scope
	_scene = null
	_scene_key = ""
	_scope = null
	_root_panel = ""
	_ui_root = null
	if is_instance_valid(old_ui_root):
		old_ui_root.queue_free()
	if is_instance_valid(old_scene):
		old_scene.queue_free()
	# The scene may have called the transition from its own callback, so it is freed by the engine at the end of the
	# frame, not here.
	while is_instance_valid(old_scene) or is_instance_valid(old_ui_root):
		await tree.process_frame
		if session != _session:
			return
	if old_scope != null:
		ResourceCore.release_scope(old_scope)

	# 4 load
	var scope: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.SCENE, key)
	var loaded: Object = await ResourceCore.load(key, _scene_kind(), scope)
	if session != _session:
		return
	var packed: PackedScene = loaded as PackedScene
	if packed == null or not ResourceCore.is_loaded(key, _scene_kind()):
		_fail(job, "scene resource could not be loaded. scene=" + key)
		return
	var instance: Node = packed.instantiate()
	# A scene callback may never return, and `release` cannot resume this transition then: its locals must not keep
	# the scene resource alive after the scope drops it.
	loaded = null
	packed = null
	if not (instance is SceneBase):
		if instance != null:
			instance.free()
		_fail(job, "scene root is not SceneBase. scene=" + key)
		return
	var scene: SceneBase = instance as SceneBase
	scene.scene_key = key
	scene.scene_param = param
	scene.scope = scope
	_new_scene = scene
	# The ignore mark check of `SafeAreaCore` sees the scene UI root under the scene holder too, so it takes the
	# position and size of the safe area root before the scene enters the tree.
	_fit_new_ui_root()
	_holder.process_mode = Node.PROCESS_MODE_DISABLED
	_holder.add_child(scene)
	_hiding = true
	_hide_tree(_holder)

	# 5 preload
	var preload_request: PreloadRequest = PreloadRequest.new()
	var prefill_items: Array[PrefillItem] = []
	scene.on_preload(preload_request, prefill_items)
	if session != _session:
		return
	var preload_count: int = preload_request.items.size()
	_progress_total = 1 + preload_count + prefill_items.size() + 1
	_progress_done = 1
	_report_progress()
	if preload_count > 0:
		await _preload_items(session, preload_request, scope)
		if session != _session:
			return
	for item: PrefillItem in prefill_items:
		var fill: Array[PrefillItem] = [item]
		await PoolCore.prefill(fill)
		if session != _session:
			return
		_progress_done += 1
		_report_progress()

	# 6 prepare
	var retries: int = 0
	while true:
		var prepared: bool = await _prepare_scene(scene)
		if session != _session:
			return
		if prepared:
			break
		if boot:
			_fail(job, "on_prepare of the boot scene returned false. scene=" + key)
			return
		_unblock()
		var outcome: int = await _ask_retry(session, retries < _retry_count)
		if session != _session:
			return
		if outcome == _OUTCOME_NOT_OPENED:
			_fail(job, "retry popup could not be opened. scene=" + key)
			return
		if outcome != _OUTCOME_RETRY:
			_end_with_restart(job)
			return
		_block_token = InputBlockCore.block(_REASON, UICore.get_block_pass_list())
		if _block_token == 0:
			_fail(job, "transition block could not be put. scene=" + key)
			return
		retries += 1
	_progress_done = _progress_total
	_report_progress()

	# 7 start
	UICore.set_panel_lock(false)
	_show_hidden()
	_holder.process_mode = Node.PROCESS_MODE_INHERIT
	var ui_root: Control = scene.ui_root
	if is_instance_valid(ui_root):
		ui_root.reparent(_scene_ui_area)
		ui_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_ui_root = ui_root
	_new_scene = null
	_scene = scene
	_scene_key = key
	_scope = scope
	_root_panel = scene.root_panel
	if not _root_panel.is_empty():
		var opened: bool = await UICore.open_root_panel(_root_panel)
		if session != _session:
			return
		if not opened:
			_fail(job, "root panel could not be opened. scene=%s panel=%s" % [key, _root_panel])
			return
	await scene.on_start()
	if session != _session:
		return

	# 8 end
	if _loading_shown:
		var until: int = _shown_at + _min_display_ms
		if TimeCore.get_real_time() < until:
			await _wait_until(until)
			if session != _session:
				return
		await _hide_loading_screen()
		if session != _session:
			return
	_clear_effects()
	_unblock()
	_transitioning = false
	_transition_key = ""
	_booted = true
	_job = null
	_progress_done = 0
	_progress_total = 0
	var started: SceneStartedEvent = EventCore.acquire(SceneStartedEvent) as SceneStartedEvent
	if started != null:
		started.scene_key = key
		started.duration_ms = TimeCore.get_real_time() - started_at
		EventCore.publish(started)
	job.finish(true)


# Stage 1: shows the loading screen, making it the first time, and waits for `on_show`. When the loading screen could
# not be made, including an empty `loadingScreen` key, it returns without one.
static func _show_loading_screen(session: RefCounted, key: String) -> void:
	if not is_instance_valid(_loading_screen):
		_loading_screen = null
		var loaded: Object = await ResourceCore.load(_loading_screen_key, _scene_kind(), ResourceCore.get_global_scope())
		if session != _session:
			return
		var packed: PackedScene = loaded as PackedScene
		var instance: Node = null
		if packed != null:
			instance = packed.instantiate()
		# `on_show` may never return; see the scene resource in `_run`.
		loaded = null
		packed = null
		if not (instance is LoadingScreenBase):
			if instance != null:
				instance.free()
			LogCore.log_error(_TAG, "loading screen root is not LoadingScreenBase. loading screen=" + _loading_screen_key)
			return
		var made: LoadingScreenBase = instance as LoadingScreenBase
		made.visible = false
		_loading_area.add_child(made)
		made.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_loading_screen = made
	var screen: LoadingScreenBase = _loading_screen
	screen.visible = true
	_loading_shown = true
	_shown_at = TimeCore.get_real_time()
	_progress_last = 0
	screen.on_progress(0)
	await screen.on_show(key)


static func _hide_loading_screen() -> void:
	var screen: LoadingScreenBase = _loading_screen
	if is_instance_valid(screen):
		var session: RefCounted = _session
		await screen.on_hide()
		if session != _session:
			return
		if is_instance_valid(screen):
			screen.visible = false
	_loading_shown = false


# ogw:input_boundary
static func _prepare_scene(scene: SceneBase) -> bool:
	var value: Variant = await scene.on_prepare()
	return value is bool and value == true


# Opens the retry popup and waits for its answer, an `_OUTCOME_*`.
static func _ask_retry(session: RefCounted, can_retry: bool) -> int:
	var wait: _POPUP_WAIT = _POPUP_WAIT.new()
	_popup_wait = wait
	var param: SystemPopupParam = _retry_popup_param(can_retry)
	_popup_param = param
	var opened: bool = await UICore.open_system_popup(param, SceneCore._on_popup_hidden)
	if session != _session:
		return _OUTCOME_NONE
	if not opened:
		_popup_wait = null
		return _OUTCOME_NOT_OPENED
	if wait.outcome == _OUTCOME_NONE:
		await wait.decided
		if session != _session:
			return _OUTCOME_NONE
	_popup_wait = null
	return wait.outcome


static func _retry_popup_param(can_retry: bool) -> SystemPopupParam:
	var button: SystemPopupButton = SystemPopupButton.new()
	if can_retry:
		button.label = ReservedString.scene_retry()
		button.callback = SceneCore._on_retry_pressed
	else:
		button.label = ReservedString.scene_restart()
		button.callback = SceneCore._on_restart_pressed
	# No back button: back input does not close the retry popup.
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.scene_prepare_failed()
	param.buttons = [button]
	return param


static func _on_retry_pressed() -> void:
	_decide(_OUTCOME_RETRY)


static func _on_restart_pressed() -> void:
	_decide(_OUTCOME_RESTART)


# A button press calls the hidden callback before the button callback, so the close without a button is known only
# after the callbacks of this close returned.
static func _on_popup_hidden() -> void:
	var wait: _POPUP_WAIT = _popup_wait
	if wait == null or wait.outcome != _OUTCOME_NONE:
		return
	SceneCore._check_closed_without_button.bind(wait).call_deferred()


static func _check_closed_without_button(wait: _POPUP_WAIT) -> void:
	if wait != _popup_wait:
		return
	_decide(_OUTCOME_CLOSED)


# Answers the open retry popup. The transition goes on after the popup callback returned.
static func _decide(outcome: int) -> void:
	var wait: _POPUP_WAIT = _popup_wait
	if wait == null or wait.outcome != _OUTCOME_NONE:
		return
	wait.outcome = outcome
	wait.decided.emit.call_deferred()


static func _wait_until(time: int) -> void:
	var wait: _WAIT = _WAIT.new()
	_deadline = time
	_deadline_wait = wait
	await wait.reached


# Preloads every item of `preload_request` with a request of its own, all at once, so that the progress rises when
# each item ends.
static func _preload_items(session: RefCounted, preload_request: PreloadRequest, scope: Scope) -> void:
	var wait: _WAIT = _WAIT.new()
	wait.remaining = preload_request.items.size()
	_preload_wait = wait
	for item: PreloadRequest.Item in preload_request.items:
		var single: PreloadRequest = PreloadRequest.new()
		single.add_item(item.key, item.kind, item.shader_warmup)
		_preload_item(session, wait, single, scope)
	if wait.remaining > 0:
		await wait.reached
	if session == _session:
		_preload_wait = null


static func _preload_item(session: RefCounted, wait: _WAIT, single: PreloadRequest, scope: Scope) -> void:
	await ResourceCore.preload_resources(single, scope)
	if session != _session:
		return
	_progress_done += 1
	_report_progress()
	wait.remaining -= 1
	if wait.remaining == 0:
		wait.reached.emit()


# Unrecoverable failure: the transition stops at this stage and ends with `false`. The loading screen and the panel
# lock stay, and the module stays in transition until `release`.
static func _fail(job: _JOB, reason: String) -> void:
	LogCore.log_error(_TAG, reason)
	_unblock()
	_clear_effects()
	var session: RefCounted = _session
	var event: FatalErrorRequestedEvent = EventCore.acquire(FatalErrorRequestedEvent) as FatalErrorRequestedEvent
	if event != null:
		event.module = _TAG
		event.reason = reason
		EventCore.publish(event)
	if session == _session:
		_job = null
	job.finish(false)


# The retry popup ended with `[scene_restart]` or without a button: the transition ends with `false` and the module
# stays in transition until `release`.
static func _end_with_restart(job: _JOB) -> void:
	_clear_effects()
	var session: RefCounted = _session
	var event: RestartRequestedEvent = EventCore.acquire(RestartRequestedEvent) as RestartRequestedEvent
	if event != null:
		event.module = _TAG
		EventCore.publish(event)
	if session == _session:
		_job = null
	job.finish(false)


# A transition block that a forced release already lifted is not unblocked again.
static func _unblock() -> void:
	if _block_token != 0 and InputBlockCore.is_active(_block_token):
		InputBlockCore.unblock(_block_token)
	_block_token = 0


# Clears the `ScreenEffectCore` effects of the loading screen.
static func _clear_effects() -> void:
	if is_instance_valid(_loading_screen) and ScreenEffectCore.is_initialized():
		ScreenEffectCore.clear_owner(_loading_screen)


@warning_ignore("integer_division")
static func _report_progress() -> void:
	if _progress_total <= 0:
		return
	var permille: int = mini(_progress_done * 1000 / _progress_total, 1000)
	if permille <= _progress_last:
		return
	_progress_last = permille
	if _loading_shown and is_instance_valid(_loading_screen):
		_loading_screen.on_progress(permille)


static func _scene_kind() -> int:
	return ResourceCore.BaseKind.PACKED_SCENE


# Hides every top visual node under `node`.
static func _hide_tree(node: Node) -> void:
	for child: Node in node.get_children():
		_hide_if_top(child)
		_hide_tree(child)


# Hides `node` when it is a top visual node that is visible, and keeps it to show it in stage 7.
static func _hide_if_top(node: Node) -> void:
	var parent: Node = node.get_parent()
	if node is CanvasLayer:
		var layer: CanvasLayer = node as CanvasLayer
		if layer.visible:
			layer.visible = false
			_hidden.append(node)
	elif node is CanvasItem:
		var item: CanvasItem = node as CanvasItem
		if item.visible and not (parent is CanvasItem) and not (parent is CanvasLayer):
			item.visible = false
			_hidden.append(node)
	elif node is Node3D:
		var spatial: Node3D = node as Node3D
		if spatial.visible and not (parent is Node3D):
			spatial.visible = false
			_hidden.append(node)


# From stage 4 until stage 7 moves it, the scene UI root of the new scene takes the position and size of the safe area
# root of the `SceneUI` layer: in stage 4 and on every `SafeAreaChangedEvent`.
static func _fit_new_ui_root() -> void:
	if not _is_initialized or not is_instance_valid(_new_scene) or not is_instance_valid(_scene_ui_area):
		return
	var ui_root: Control = _new_scene.ui_root
	if not is_instance_valid(ui_root) or ui_root.get_parent() == _scene_ui_area:
		return
	var area: Rect2 = _scene_ui_area.get_global_rect()
	ui_root.set_anchors_preset(Control.PRESET_TOP_LEFT)
	ui_root.position = area.position
	ui_root.size = area.size


static func _show_hidden() -> void:
	_hiding = false
	for node: Node in _hidden:
		if not is_instance_valid(node):
			continue
		if node is CanvasLayer:
			(node as CanvasLayer).visible = true
		elif node is CanvasItem:
			(node as CanvasItem).visible = true
		elif node is Node3D:
			(node as Node3D).visible = true
	_hidden.clear()


static func _on_node_added(node: Node) -> void:
	if not _hiding or not is_instance_valid(_holder) or not _holder.is_ancestor_of(node):
		return
	_hide_if_top(node)


# The frame check of the core node: the end of a wait until a real elapsed time.
static func _check_frame() -> void:
	if not _is_initialized:
		return
	if _deadline_wait != null and TimeCore.get_real_time() >= _deadline:
		var wait: _WAIT = _deadline_wait
		_deadline_wait = null
		wait.reached.emit()


static func _on_node_exit(node: Node) -> void:
	if node != _node or not _is_initialized:
		return
	_disconnect(_node)
	_end_state(false)


# Stops the transition, destroys the objects of the module and resets the state. `detach`: remove the objects from
# their parents first; false while the tree is torn down.
static func _end_state(detach: bool) -> void:
	var job: _JOB = _job
	var deadline_wait: _WAIT = _deadline_wait
	var preload_wait: _WAIT = _preload_wait
	var popup_wait: _POPUP_WAIT = _popup_wait
	_clear_effects()
	if InputBlockCore.is_initialized():
		_unblock()
	var objects: Array[Node] = [_ui_root, _scene, _new_scene, _loading_screen, _scene_ui_area, _loading_area, _holder]
	_is_initialized = false
	_session = null
	_node = null
	_holder = null
	_scene_ui_area = null
	_loading_area = null
	_loading_screen_key = ""
	_min_display_ms = 0
	_retry_count = 0
	_scene = null
	_scene_key = ""
	_scope = null
	_root_panel = ""
	_ui_root = null
	_new_scene = null
	_booted = false
	_transitioning = false
	_transition_key = ""
	_job = null
	_block_token = 0
	_loading_screen = null
	_loading_shown = false
	_shown_at = 0
	_hiding = false
	_hidden = []
	_progress_done = 0
	_progress_total = 0
	_progress_last = 0
	_deadline = 0
	_deadline_wait = null
	_preload_wait = null
	_popup_wait = null
	_popup_param = null
	for object: Node in objects:
		_destroy(object, detach)
	if job != null:
		job.finish(false)
	if deadline_wait != null:
		deadline_wait.reached.emit()
	if preload_wait != null:
		preload_wait.reached.emit()
	if popup_wait != null:
		popup_wait.decided.emit()


static func _disconnect(node: _CORE_NODE) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree != null and is_instance_valid(node) and tree.node_added.is_connected(node.on_node_added):
		tree.node_added.disconnect(node.on_node_added)
	if is_instance_valid(node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(node)


static func _destroy(node: Node, detach: bool) -> void:
	if not is_instance_valid(node) or node.is_queued_for_deletion():
		return
	if detach:
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
	node.queue_free()
