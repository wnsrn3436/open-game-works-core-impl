// OS secure storage of one desktop platform under `OgwSecureStorage`: `backend_windows.cpp` (Credential Manager) or
// `backend_linux.cpp` (Secret Service). The functions run on the operation thread of `OgwSecureStorage`, one at a time.

#pragma once

#include <cstdint>
#include <string>

namespace ogw {

// Result status of an operation, the values of `TokenStorage.Status` of AuthCore.
constexpr int32_t STATUS_OK = 0;
constexpr int32_t STATUS_NOT_FOUND = 1;
constexpr int32_t STATUS_DENIED = 2;
constexpr int32_t STATUS_UNSUPPORTED = 3;
constexpr int32_t STATUS_FAILED = 4;

struct Result {
	int32_t status;
	// UTF-8 item text of a read that is `STATUS_OK`.
	std::string text;
};

namespace backend {

// True when this run can use the OS secure storage, checked once. Without it the run gets no singleton.
bool available();
// The item `name` (UTF-8, not empty). A missing item is `STATUS_NOT_FOUND`.
Result read(const std::string &name);
// Writes the UTF-8 `text` as the item `name`, replacing an earlier one.
Result write(const std::string &name, const std::string &text);
// Removes the item `name`. A missing item is `STATUS_NOT_FOUND`.
Result remove(const std::string &name);

} // namespace backend

} // namespace ogw
