class_name CoreModules
extends RefCounted


static func modules() -> Array[CoreModuleEntry]:
	var list: Array[CoreModuleEntry] = [
		_entry("LogCore", LogCore.init, LogCore.release, LogCore.is_initialized),
		_entry("EventCore", EventCore.init, EventCore.release, EventCore.is_initialized),
		_entry("TimeCore", TimeCore.init, TimeCore.release, TimeCore.is_initialized),
		_entry("LocalDataCore", LocalDataCore.init, LocalDataCore.release, LocalDataCore.is_initialized),
		_entry("ResourceCore", ResourceCore.init, ResourceCore.release, ResourceCore.is_initialized),
		_entry("PoolCore", PoolCore.init, PoolCore.release, PoolCore.is_initialized),
		_entry("DataCore", DataCore.init, DataCore.release, DataCore.is_initialized),
		_entry("UserStateCore", UserStateCore.init, UserStateCore.release, UserStateCore.is_initialized),
		_entry("ResolutionCore", ResolutionCore.init, ResolutionCore.release, ResolutionCore.is_initialized),
		_entry("SafeAreaCore", SafeAreaCore.init, SafeAreaCore.release, SafeAreaCore.is_initialized),
		_entry("InputBlockCore", InputBlockCore.init, InputBlockCore.release, InputBlockCore.is_initialized),
		_entry("InputCore", InputCore.init, InputCore.release, InputCore.is_initialized),
		_entry("LocalizationCore", LocalizationCore.init, LocalizationCore.release, LocalizationCore.is_initialized),
		_entry("SoundCore", SoundCore.init, SoundCore.release, SoundCore.is_initialized),
		_entry("TweenCore", TweenCore.init, TweenCore.release, TweenCore.is_initialized),
		_entry("CameraCore", CameraCore.init, CameraCore.release, CameraCore.is_initialized),
		_entry("UICore", UICore.init, UICore.release, UICore.is_initialized),
		_entry("VirtualPadCore", VirtualPadCore.init, VirtualPadCore.release, VirtualPadCore.is_initialized),
		_entry("ScreenEffectCore", ScreenEffectCore.init, ScreenEffectCore.release, ScreenEffectCore.is_initialized),
		_entry("MessageCore", MessageCore.init, MessageCore.release, MessageCore.is_initialized),
		_entry("NetworkCore", NetworkCore.init, NetworkCore.release, NetworkCore.is_initialized),
		_entry("AuthCore", AuthCore.init, AuthCore.release, AuthCore.is_initialized),
		_entry("PushCore", PushCore.init, PushCore.release, PushCore.is_initialized),
		_entry("PaymentCore", PaymentCore.init, PaymentCore.release, PaymentCore.is_initialized),
		_entry("AdCore", AdCore.init, AdCore.release, AdCore.is_initialized),
		_entry("RequirementCore", RequirementCore.init, RequirementCore.release, RequirementCore.is_initialized),
		_entry("BadgeCore", BadgeCore.init, BadgeCore.release, BadgeCore.is_initialized),
		_entry("SceneCore", SceneCore.init, SceneCore.release, SceneCore.is_initialized),
		_entry("ShortcutCore", ShortcutCore.init, ShortcutCore.release, ShortcutCore.is_initialized),
		_entry("CutsceneCore", CutsceneCore.init, CutsceneCore.release, CutsceneCore.is_initialized),
		_entry("TutorialCore", TutorialCore.init, TutorialCore.release, TutorialCore.is_initialized),
		_entry("RealtimeCore", RealtimeCore.init, RealtimeCore.release, RealtimeCore.is_initialized),
		_entry("GameUpdateCore", GameUpdateCore.init, GameUpdateCore.release, GameUpdateCore.is_initialized),
		_entry("QualityCore", QualityCore.init, QualityCore.release, QualityCore.is_initialized),
		_entry("AccessibilityCore", AccessibilityCore.init, AccessibilityCore.release, AccessibilityCore.is_initialized),
		_entry("NativeUiCore", NativeUiCore.init, NativeUiCore.release, NativeUiCore.is_initialized),
		_entry("NoticeCore", NoticeCore.init, NoticeCore.release, NoticeCore.is_initialized),
		_entry("ChatCore", ChatCore.init, ChatCore.release, ChatCore.is_initialized),
		_entry("RemoteConfigCore", RemoteConfigCore.init, RemoteConfigCore.release, RemoteConfigCore.is_initialized),
	]
	return list


static func _entry(name: String, init: Callable, release: Callable, is_initialized: Callable) -> CoreModuleEntry:
	var entry := CoreModuleEntry.new()
	entry.name = name
	entry.init = init
	entry.release = release
	entry.is_initialized = is_initialized
	return entry
