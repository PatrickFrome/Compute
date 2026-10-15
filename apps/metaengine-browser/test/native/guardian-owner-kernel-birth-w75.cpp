#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include "browser-guardian-owner-enrollment-observer.hpp"
#include <cstdint>
#include <iostream>
#include <string>

int main() {
    using metaengine::guardian::browserGuardianClientKernelBirthExact;
    const DWORD pid = GetCurrentProcessId();
    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) return 2;
    ULARGE_INTEGER ticks{};
    ticks.LowPart = creation.dwLowDateTime;
    ticks.HighPart = creation.dwHighDateTime;
    const std::uint64_t birth = ticks.QuadPart;
    if (!browserGuardianClientKernelBirthExact(pid, birth)) return 3;
    // 1 tick = 100ns; both births appear in the SAME ISO millisecond.
    if (browserGuardianClientKernelBirthExact(pid, birth + 1)) return 4;
    if (browserGuardianClientKernelBirthExact(pid, birth - 1)) return 5;
    if (browserGuardianClientKernelBirthExact(pid, 0)) return 6;
    if (browserGuardianClientKernelBirthExact(0, birth)) return 7;
    if (browserGuardianClientKernelBirthExact(MAXDWORD, birth)) return 8;
    std::cout << "GUARDIAN_KERNEL_BIRTH_100NS_EXACT_PASS" << std::endl;
    return 0;
}
