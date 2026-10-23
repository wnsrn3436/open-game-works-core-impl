// `OgwNativeUi` singleton of macOS: the store review request window (`SKStoreReviewController`) and the share
// window (`NSSharingServicePicker`).

#pragma once

#include <godot_cpp/classes/object.hpp>
#include <godot_cpp/templates/hash_map.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/string.hpp>

namespace ogw {

class OgwNativeUi : public godot::Object {
	GDCLASS(OgwNativeUi, godot::Object)

public:
	static constexpr int32_t STATUS_CLOSED = 0;
	static constexpr int32_t STATUS_FAILED = 1;

	// Asks the OS for the store review request window. True when the OS took the request.
	bool request_review();
	// Opens the share window with `text` and the PNG `png` (empty for none). The operation ID, or 0 when the window
	// cannot open (no window to show it on, or a share window still on screen).
	int64_t start_share(const godot::String &text, const godot::PackedByteArray &png);
	// Empty until share `id` closes, then `[status]` once. `[1]` for an ID with no share.
	godot::PackedInt32Array take_share_result(int64_t id);
	// The caller stopped waiting for share `id`: its result is dropped.
	void cancel_share(int64_t id);

	// The share window of share `id` closed with `status`. Called on the main thread by the picker delegate.
	void finish_share(int64_t id, int32_t status);

	OgwNativeUi();
	~OgwNativeUi();

protected:
	static void _bind_methods();

private:
	// Share whose window is on screen; 0 when none.
	int64_t open_share = 0;
	// True when the caller stopped waiting for `open_share`: its result is not kept.
	bool open_share_dropped = false;
	int64_t next_id = 1;
	// Ended shares the caller has not taken yet: ID to status.
	godot::HashMap<int64_t, int32_t> results;
	// Picker and its delegate of the open share (Objective-C objects, retained).
	void *picker = nullptr;
	void *delegate = nullptr;
};

} // namespace ogw
