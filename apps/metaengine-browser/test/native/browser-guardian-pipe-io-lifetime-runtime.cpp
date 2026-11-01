// Windows-only disposable pipe execution. This includes the ACTUAL service I/O
// functions, without registering/installing/starting a Windows service.
#ifdef NDEBUG
#error Native lifetime tests require assertions enabled
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <atomic>
// Explicit test-only cancellation fault injection. The sixth case keeps a REAL
// pending Windows pipe read alive across the join timeout. It does not claim
// that Windows itself ignored an accepted cancellation request.
static std::atomic<bool> deferCancellation{false};
static BOOL testCancelIoEx(HANDLE pipe, OVERLAPPED* operation) {
    if(deferCancellation.load()) return TRUE;
    return ::CancelIoEx(pipe,operation);
}
#define CancelIoEx testCancelIoEx
#define wmain guardianUnusedScmEntryForPipeTest
#include "../../native/browser-guardian-scm/browser-guardian-scm-service.cpp"
#undef wmain
#undef CancelIoEx
#include <cassert>
#include <chrono>
#include <future>
#include <vector>

using namespace std::chrono_literals;
namespace {
struct Handle {
    HANDLE value = nullptr;
    explicit Handle(HANDLE h = nullptr) : value(h) {}
    ~Handle() { if(value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};
struct PipePair {
    metaengine::guardian::OwnerEnrollmentPipe server;
    Handle client;
    explicit PipePair(unsigned index) {
        const auto name=L"\\\\.\\pipe\\METAENGINEGuardianDisposableIo-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(index);
        assert(server.create(name));
        client.value=CreateFileW(name.c_str(),metaengine::guardian::browserGuardianOwnerEnrollmentClientAccessMask(),0,nullptr,OPEN_EXISTING,0,nullptr);
        assert(client.value != INVALID_HANDLE_VALUE);
        assert(connectPipe(&server));
    }
};
void terminalPendingConnect() {
    metaengine::guardian::OwnerEnrollmentPipe pipe;
    const auto name=L"\\\\.\\pipe\\METAENGINEGuardianDisposableConnect-"+std::to_wstring(GetCurrentProcessId());
    assert(pipe.create(name));Handle event(CreateEventW(nullptr,TRUE,FALSE,nullptr));assert(event.value);
    OVERLAPPED operation{};operation.hEvent=event.value;
    assert(!ConnectNamedPipe(pipe.handle(),&operation));assert(GetLastError()==ERROR_IO_PENDING);
    SetEvent(g_stop_event);assert(!waitOverlapped(pipe.handle(),&operation));
    assert(HasOverlappedIoCompleted(&operation));ResetEvent(g_stop_event);
}
void readStop(unsigned index) {
    PipePair pair(index);std::string output;
    auto read=std::async(std::launch::async,[&]{return readRequest(pair.server.handle(),&output);});
    assert(read.wait_for(50ms)==std::future_status::timeout);
    g_status.dwCurrentState=SERVICE_RUNNING;
    assert(serviceControlHandler(SERVICE_CONTROL_STOP,0,nullptr,nullptr)==NO_ERROR);
    // Exercise the actual stop-control -> stop event path, without an SCM
    // registration. Physical SERVICE_STOPPED is not claimed by this test.
    // If completion does not settle the test must fail, never claim cleanup.
    assert(read.wait_for(10s)==std::future_status::ready);assert(!read.get());assert(output.empty());
    ResetEvent(g_stop_event);
}
void readDisconnect(unsigned index) {
    PipePair pair(index);std::string output;
    auto read=std::async(std::launch::async,[&]{return readRequest(pair.server.handle(),&output);});
    assert(read.wait_for(50ms)==std::future_status::timeout);
    CloseHandle(pair.client.value);pair.client.value=nullptr;
    assert(read.wait_for(10s)==std::future_status::ready);assert(!read.get());assert(output.empty());
}
void writeStop(unsigned index) {
    PipePair pair(index);const std::string response(kMaxRequestBytes,'x');
    auto write=std::async(std::launch::async,[&]{return writeResponse(pair.server.handle(),response);});
    assert(write.wait_for(50ms)==std::future_status::timeout);SetEvent(g_stop_event);
    assert(write.wait_for(10s)==std::future_status::ready);assert(!write.get());ResetEvent(g_stop_event);
}
void retainedAcrossTimeoutFaultInjection(unsigned index) {
    PipePair pair(index);Handle event(CreateEventW(nullptr,TRUE,FALSE,nullptr));assert(event.value);
    OVERLAPPED operation{};operation.hEvent=event.value;char buffer[8]{};DWORD got=0;
    assert(!ReadFile(pair.server.handle(),buffer,sizeof(buffer),&got,&operation));assert(GetLastError()==ERROR_IO_PENDING);
    deferCancellation.store(true);
    auto join=std::async(std::launch::async,[&]{metaengine::guardian::cancelAndJoinGuardianPipeIo(pair.server.handle(),&operation);});
    assert(join.wait_for(5500ms)==std::future_status::timeout);
    assert(!HasOverlappedIoCompleted(&operation));assert(buffer[0]=='\0');
    DWORD sent=0;assert(WriteFile(pair.client.value,"safe\n",5,&sent,nullptr));assert(sent==5);
    assert(join.wait_for(10s)==std::future_status::ready);join.get();deferCancellation.store(false);
    assert(GetOverlappedResult(pair.server.handle(),&operation,&got,FALSE));assert(got==5);
    assert(std::string(buffer,got)=="safe\n");
}
void completedBeforeCancel(unsigned index) {
    PipePair pair(index);Handle event(CreateEventW(nullptr,TRUE,FALSE,nullptr));assert(event.value);
    OVERLAPPED operation{};operation.hEvent=event.value;char buffer[8]{};DWORD got=0;
    assert(!ReadFile(pair.server.handle(),buffer,sizeof(buffer),&got,&operation));assert(GetLastError()==ERROR_IO_PENDING);
    DWORD sent=0;assert(WriteFile(pair.client.value,"ok\n",3,&sent,nullptr));assert(sent==3);
    assert(WaitForSingleObject(event.value,5000)==WAIT_OBJECT_0);
    // CancelIoEx may now report ERROR_NOT_FOUND: completion, not cancellation
    // success, is the required ownership-release condition.
    metaengine::guardian::cancelAndJoinGuardianPipeIo(pair.server.handle(),&operation);
    assert(GetOverlappedResult(pair.server.handle(),&operation,&got,FALSE));assert(got==3);
}
}
int wmain() {
    Handle stop(CreateEventW(nullptr,TRUE,FALSE,nullptr));assert(stop.value);g_stop_event=stop.value;
    terminalPendingConnect();readStop(1);readDisconnect(2);writeStop(3);completedBeforeCancel(4);retainedAcrossTimeoutFaultInjection(5);
    g_stop_event=nullptr;
    std::cout << "guardian_pipe_io_runtime=PASS; real_cases=5; injected_cancel_delay_cases=1; service_installed=false; loaded_code_attested=false\n";
    return 0;
}
