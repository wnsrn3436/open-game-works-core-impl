class_name SoundPageAudio
extends RefCounted
## The page audio of the browser runtime, for the browser run tests of what SoundCore does while the page audio context
## is suspended. A real browser keeps the context suspended until a user gesture; the browser run starts the page with
## an autoplay policy that runs it, so these tests suspend it themselves. The engine keeps its context out of reach of
## page scripts and creates it at start: `hook` finds it through the `baseLatency` getter, which the engine reads every
## 1000 ms for its output latency, so it is known at most 1000 ms after `hook`. Stream playback creates no page audio
## nodes after start, so the context is the only page object these tests reach.

const _HOOK: String = """
(function () {
	if (window.ogwPageAudio) return 'ok';
	const latency = Object.getOwnPropertyDescriptor(AudioContext.prototype, 'baseLatency');
	if (!latency || !latency.get) return 'no baseLatency getter';
	const page = { contexts: [] };
	Object.defineProperty(AudioContext.prototype, 'baseLatency', {
		configurable: true,
		enumerable: latency.enumerable,
		get: function () {
			if (!page.contexts.includes(this)) page.contexts.push(this);
			return latency.get.call(this);
		},
	});
	page.state = function () {
		return page.contexts.length === 0 ? 'none' : page.contexts[0].state;
	};
	page.restore = function () {
		Object.defineProperty(AudioContext.prototype, 'baseLatency', latency);
		for (const context of page.contexts) context.resume();
		delete window.ogwPageAudio;
		return 'ok';
	};
	window.ogwPageAudio = page;
	return 'ok';
})()
"""


## Starts finding the page audio context. False outside the browser runtime.
static func hook() -> bool:
	if OS.get_name() != "Web":
		return false
	return str(JavaScriptBridge.eval(_HOOK, true)) == "ok"


## Gives the page audio back: resumes the context and puts the page's `baseLatency` getter back.
static func unhook() -> void:
	if OS.get_name() == "Web":
		JavaScriptBridge.eval("window.ogwPageAudio ? window.ogwPageAudio.restore() : 'ok'", true)


## `none` before the engine's first latency read after `hook`, else the context state (`running`, `suspended`).
static func state() -> String:
	return str(JavaScriptBridge.eval("window.ogwPageAudio ? window.ogwPageAudio.state() : 'none'", true))


static func suspend() -> void:
	JavaScriptBridge.eval("window.ogwPageAudio.contexts[0].suspend(); 'ok'", true)


static func resume() -> void:
	JavaScriptBridge.eval("window.ogwPageAudio.contexts[0].resume(); 'ok'", true)


## Waits real frames until the context state is `wanted`, at most `limit_ms`. Whether it got there.
static func wait_state(wanted: String, limit_ms: int) -> bool:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var until: int = Time.get_ticks_msec() + limit_ms
	while state() != wanted:
		if Time.get_ticks_msec() >= until:
			return false
		await tree.process_frame
	return true


## Waits real frames for `ms` of real time.
static func wait_real(ms: int) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	var until: int = Time.get_ticks_msec() + ms
	while Time.get_ticks_msec() < until:
		await tree.process_frame
