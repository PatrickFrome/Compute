#pragma once
// Test-only Linux symbol shim. This is never a Windows pipe/SCM implementation.
#include <cstring>
#include <dlfcn.h>
using HMODULE = void*;
using HANDLE = void*;
using FARPROC = void (*)();
inline HMODULE GetModuleHandleW(const wchar_t*) { return dlopen(nullptr, RTLD_NOW); }
inline FARPROC GetProcAddress(HMODULE module, const char* name) {
    void* symbol = dlsym(module, name);
    FARPROC result = nullptr;
    static_assert(sizeof(result) == sizeof(symbol));
    std::memcpy(&result, &symbol, sizeof(result));
    return result;
}
