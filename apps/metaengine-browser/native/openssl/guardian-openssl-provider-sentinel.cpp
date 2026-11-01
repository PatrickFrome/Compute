// Adversarial test DLL, used only in the disposable dependency build workspace.
#ifdef _WIN32
#include <windows.h>

static void mark_loaded() {
    SetEnvironmentVariableA("GUARDIAN_SENTINEL_LOADED", "1");
    constexpr DWORD kMarkerCapacity = 1024;
    WCHAR marker[kMarkerCapacity] = {};
    const DWORD length = GetEnvironmentVariableW(L"GUARDIAN_SENTINEL_MARKER_FILE", marker, kMarkerCapacity);
    if (length > 0 && length < kMarkerCapacity) {
        HANDLE file = CreateFileW(marker, GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    }
}

extern "C" __declspec(dllexport) int OSSL_provider_init(const void*, const void*, const void**) {
    mark_loaded();
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) mark_loaded();
    return TRUE;
}
#else
#include <cstdlib>
#include <cstdio>
static void mark_loaded() {
    setenv("GUARDIAN_SENTINEL_LOADED", "1", 1);
    const char* marker = std::getenv("GUARDIAN_SENTINEL_MARKER_FILE");
    if (marker != nullptr) {
        std::FILE* file = std::fopen(marker, "wx");
        if (file != nullptr) std::fclose(file);
    }
}
extern "C" int OSSL_provider_init(const void*, const void*, const void**) {
    mark_loaded();
    return 0;
}
__attribute__((constructor)) static void guardian_provider_sentinel_loaded() {
    mark_loaded();
}
#endif
