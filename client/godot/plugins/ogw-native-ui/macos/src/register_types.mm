// GDExtension entry of the `ogw-native-ui` macOS library: registers the `OgwNativeUi` singleton.

#include "ogw_native_ui.h"

#include <gdextension_interface.h>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

using namespace godot;

static ogw::OgwNativeUi *singleton = nullptr;

static void initialize_ogw_native_ui(ModuleInitializationLevel level) {
	if (level != MODULE_INITIALIZATION_LEVEL_SCENE) {
		return;
	}
	GDREGISTER_CLASS(ogw::OgwNativeUi);
	singleton = memnew(ogw::OgwNativeUi);
	Engine::get_singleton()->register_singleton("OgwNativeUi", singleton);
}

static void uninitialize_ogw_native_ui(ModuleInitializationLevel level) {
	if (level != MODULE_INITIALIZATION_LEVEL_SCENE || singleton == nullptr) {
		return;
	}
	Engine::get_singleton()->unregister_singleton("OgwNativeUi");
	memdelete(singleton);
	singleton = nullptr;
}

extern "C" {
GDExtensionBool GDE_EXPORT ogw_native_ui_init(GDExtensionInterfaceGetProcAddress get_proc_address,
		GDExtensionClassLibraryPtr library, GDExtensionInitialization *initialization) {
	GDExtensionBinding::InitObject init_obj(get_proc_address, library, initialization);
	init_obj.register_initializer(initialize_ogw_native_ui);
	init_obj.register_terminator(uninitialize_ogw_native_ui);
	init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
	return init_obj.init();
}
}
