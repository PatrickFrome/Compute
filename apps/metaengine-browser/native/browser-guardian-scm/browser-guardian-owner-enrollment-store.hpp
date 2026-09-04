#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <string>

namespace metaengine::guardian {

struct OwnerEnrollmentDurableRecord {
    std::wstring expected_owner_sid;
    std::string enrollment_evidence_sha256;
    std::string device_key_fingerprint_sha256;
};

struct OwnerEnrollmentStoreResult {
    bool present = false;
    bool committed = false;
    bool exact = false;
    bool provenance_exact = false;
    bool owner_mismatch = false;
    bool corrupt = false;
    bool root_trusted = false;
    bool staging_flushed = false;
    bool move_committed = false;
    bool post_commit_readback = false;
    DWORD win32_error = ERROR_SUCCESS;
    std::string reason;
    OwnerEnrollmentDurableRecord record;
};

class OwnerEnrollmentStore final {
public:
    explicit OwnerEnrollmentStore(std::wstring root_path);

    const std::wstring& rootPath() const noexcept { return root_path_; }
    std::wstring recordPath() const;

    OwnerEnrollmentStoreResult read() const;
    OwnerEnrollmentStoreResult createIfAbsent(const OwnerEnrollmentDurableRecord& candidate) const;

private:
    std::wstring root_path_;
};

// Default machine-wide mutable state root. The store never creates or repairs this
// directory; machine bootstrap must provision it with a machine-trusted owner/DACL.
std::wstring browserGuardianOwnerEnrollmentStoreDefaultRoot();

// Read-only contract probe. The store is a bounded persistence primitive only: it
// does not observe sessions, acquire tokens, launch processes, mutate SCM, schedule
// retries, or authorize Browser/task effects.
const char* browserGuardianOwnerEnrollmentStoreContractJson() noexcept;

}  // namespace metaengine::guardian
