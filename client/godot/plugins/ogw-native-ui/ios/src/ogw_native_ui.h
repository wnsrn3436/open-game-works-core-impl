// `OgwNativeUi` singleton of iOS: the store review request window (`SKStoreReviewController`) and the share window
// (`UIActivityViewController`).

#pragma once

#include "core/object/class_db.h"
#include "core/object/object.h"
#include "core/templates/hash_map.h"
#include "core/variant/variant.h"

class OgwNativeUi : public Object {
	GDCLASS(OgwNativeUi, Object);

public:
	static constexpr int32_t STATUS_CLOSED = 0;
	static constexpr int32_t STATUS_FAILED = 1;

	// Asks the OS for the store review request window in the active window scene. True when the OS took the request.
	bool request_review();
	// Opens the share window with `text` and the PNG `png` (empty for none). The operation ID, or 0 when the window
	// cannot open (no view controller to show it on, or a share window still on screen).
	int64_t start_share(const String &text, const PackedByteArray &png);
	// Empty until share `id` closes, then `[status]` once. `[1]` for an ID with no share.
	PackedInt32Array take_share_result(int64_t id);
	// The caller stopped waiting for share `id`: its result is dropped.
	void cancel_share(int64_t id);

	// The share window of share `id` closed with `status`. Called on the main thread by the share window.
	void finish_share(int64_t id, int32_t status);

protected:
	static void _bind_methods();

private:
	// Share whose window is on screen; 0 when none.
	int64_t open_share = 0;
	// True when the caller stopped waiting for `open_share`: its result is not kept.
	bool open_share_dropped = false;
	int64_t next_id = 1;
	// Ended shares the caller has not taken yet: ID to status.
	HashMap<int64_t, int32_t> results;
};

void ogw_native_ui_init();
void ogw_native_ui_deinit();
