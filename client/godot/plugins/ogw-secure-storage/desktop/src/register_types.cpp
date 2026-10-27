// GDExtension entry of the `ogw-secure-storage` Windows and Linux library: registers the `OgwSecureStorage` class, and
// its singleton when this run can call the OS secure storage.

#include "backend.h"
#include "ogw_secure_storage.h"

#include <gdextension_interface.h>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

using namespace godot;

static ogw::OgwSecureStorage *singleton = nullptr;

static void initialize_ogw_secure_storage(ModuleInitializationLevel level) {
	if (level != MODULE_INITIALIZATION_LEVEL_SCENE) {
		return;
	}
	GDREGISTER_CLASS(ogw::OgwSecureStorage);
	// Without the OS secure storage library the run has no singleton, as on a host without the plugin build.
	if (!ogw::backend::available()) {
		return;
	}
	singleton = memnew(ogw::OgwSecureStorage);
	Engine::get_singleton()->register_singleton("OgwSecureStorage", singleton);
}

static void uninitialize_ogw_secure_storage(ModuleInitializationLevel level) {
	if (level != MODULE_INITIALIZATION_LEVEL_SCENE || singleton == nullptr) {
		return;
	}
	Engine::get_singleton()->unregister_singleton("OgwSecureStorage");
	memdelete(singleton);
	singleton = nullptr;
}

extern "C" {
GDExtensionBool GDE_EXPORT ogw_secure_storage_init(GDExtensionInterfaceGetProcAddress get_proc_address,
		GDExtensionClassLibraryPtr library, GDExtensionInitialization *initialization) {
	GDExtensionBinding::InitObject init_obj(get_proc_address, library, initialization);
	init_obj.register_initializer(initialize_ogw_secure_storage);
	init_obj.register_terminator(uninitialize_ogw_secure_storage);
	init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
	return init_obj.init();
}
}
