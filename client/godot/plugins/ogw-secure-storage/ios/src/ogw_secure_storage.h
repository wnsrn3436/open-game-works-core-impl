// `OgwSecureStorage` singleton of iOS: one text item per name in the app's keychain, a generic password item of
// service `ogw-secure-storage` and account `<name>` holding the UTF-8 text, with
// `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`: readable only on this device, never synchronized with iCloud or put
// in a backup that restores to another device, and an operation never shows an OS window. The operations run one at a
// time on a background queue, in the order they started.

#pragma once

#include "core/object/class_db.h"
#include "core/object/object.h"
#include "core/variant/variant.h"

#include <memory>

struct SecureStorageState;

class OgwSecureStorage : public Object {
	GDCLASS(OgwSecureStorage, Object);

public:
	// Result status of an operation, the values of `TokenStorage.Status` of AuthCore.
	static constexpr int32_t STATUS_OK = 0;
	static constexpr int32_t STATUS_NOT_FOUND = 1;
	static constexpr int32_t STATUS_DENIED = 2;
	static constexpr int32_t STATUS_UNSUPPORTED = 3;
	static constexpr int32_t STATUS_FAILED = 4;

	// Start reading, writing `text` as, or removing the item `name`. The operation ID, or 0 when `name` is empty.
	int64_t start_read(const String &name);
	int64_t start_write(const String &name, const String &text);
	int64_t start_remove(const String &name);
	// Empty until operation `id` ends, then `[status, text]` once: `text` is the item text of a read that is
	// `STATUS_OK`, else empty. `[STATUS_FAILED, ""]` for an ID with no operation.
	PackedStringArray take_result(int64_t id);
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

void ogw_secure_storage_init();
void ogw_secure_storage_deinit();
