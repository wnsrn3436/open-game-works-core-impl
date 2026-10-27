// `OgwSecureStorage` singleton of Windows and Linux: one text item per name in the OS secure storage of `backend.h`.
// The operations run one at a time on one operation thread, in the order they started, and an operation never shows
// an OS window.

#pragma once

#include <godot_cpp/classes/object.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/string.hpp>

#include <memory>
#include <thread>

namespace ogw {

struct SecureStorageState;

class OgwSecureStorage : public godot::Object {
	GDCLASS(OgwSecureStorage, godot::Object)

public:
	// Start reading, writing `text` as, or removing the item `name`. The operation ID, or 0 when `name` is empty.
	int64_t start_read(const godot::String &name);
	int64_t start_write(const godot::String &name, const godot::String &text);
	int64_t start_remove(const godot::String &name);
	// Empty until operation `id` ends, then `[status, text]` once: `text` is the item text of a read that is
	// `STATUS_OK`, else empty. `[STATUS_FAILED, ""]` for an ID with no operation.
	godot::PackedStringArray take_result(int64_t id);
	// The caller stopped waiting for operation `id`: its result is dropped.
	void cancel(int64_t id);

	OgwSecureStorage();
	// Runs the operations already started, then ends the operation thread.
	~OgwSecureStorage();

protected:
	static void _bind_methods();

private:
	std::unique_ptr<SecureStorageState> state;
	std::thread worker;
};

} // namespace ogw
