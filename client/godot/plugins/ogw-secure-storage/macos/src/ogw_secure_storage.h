// `OgwSecureStorage` singleton of macOS: one text item per name in the data protection keychain, a generic password
// item of service `ogw-secure-storage` and account `<name>` holding the UTF-8 text, with
// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`: readable only on this device, never synchronized with iCloud, and an
// operation never shows an OS window. The operations run one at a time on a background queue, in the order they
// started.
//
// The data protection keychain needs a keychain access group, which an app gets from its entitlement
// `keychain-access-groups` or `com.apple.application-identifier` (both need a provisioning profile). A run without one
// (the Godot editor, an export without a provisioning profile) gets no singleton.

#pragma once

#include <godot_cpp/classes/object.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/string.hpp>

#include <memory>

namespace ogw {

struct SecureStorageState;

class OgwSecureStorage : public godot::Object {
	GDCLASS(OgwSecureStorage, godot::Object)

public:
	// Result status of an operation, the values of `TokenStorage.Status` of AuthCore.
	static constexpr int32_t STATUS_OK = 0;
	static constexpr int32_t STATUS_NOT_FOUND = 1;
	static constexpr int32_t STATUS_DENIED = 2;
	static constexpr int32_t STATUS_UNSUPPORTED = 3;
	static constexpr int32_t STATUS_FAILED = 4;

	// True when the app is signed with an entitlement that gives it a keychain access group.
	static bool has_keychain_access_group();

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
	~OgwSecureStorage();

protected:
	static void _bind_methods();

private:
	// Shared with the queued operations, which can end after this object is gone.
	std::shared_ptr<SecureStorageState> state;
};

} // namespace ogw
