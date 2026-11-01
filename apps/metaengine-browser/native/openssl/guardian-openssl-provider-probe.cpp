// Dependency qualification only; this does not implement Guardian signature verification.
#ifdef _WIN32
#include <windows.h>
#endif
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/opensslv.h>
#include <openssl/provider.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#ifndef OPENSSL_NO_DSO
#error Guardian dependency must disable dynamic shared objects
#endif
#ifndef OPENSSL_NO_ENGINE
#error Guardian dependency must disable engines
#endif
#ifndef OPENSSL_NO_AUTOLOAD_CONFIG
#error Guardian dependency must disable automatic configuration loading
#endif

int main() {
    if (OPENSSL_VERSION_MAJOR != 3 || OPENSSL_VERSION_MINOR != 5 || OPENSSL_VERSION_PATCH != 9
        || OpenSSL_version_num() != OPENSSL_VERSION_NUMBER) return 10;
    if (OPENSSL_init_crypto(OPENSSL_INIT_NO_LOAD_CONFIG, nullptr) != 1) return 11;
    OSSL_LIB_CTX* ctx = OSSL_LIB_CTX_new();
    if (ctx == nullptr) return 12;
    OSSL_PROVIDER* provider = OSSL_PROVIDER_load(ctx, "default");
    if (provider == nullptr || std::strcmp(OSSL_PROVIDER_get0_name(provider), "default") != 0) return 13;
    EVP_MD* digest = EVP_MD_fetch(ctx, "SHA256", "provider=default");
    EVP_MD_CTX* operation = EVP_MD_CTX_new();
    const unsigned char expected[32] = {
        0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,
        0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad
    };
    unsigned char actual[EVP_MAX_MD_SIZE] = {};
    unsigned int length = 0;
    if (digest == nullptr || operation == nullptr
        || EVP_DigestInit_ex2(operation, digest, nullptr) != 1
        || EVP_DigestUpdate(operation, "abc", 3) != 1
        || EVP_DigestFinal_ex(operation, actual, &length) != 1
        || length != sizeof(expected) || std::memcmp(expected, actual, sizeof(expected)) != 0) return 14;
    // A real test DLL is present in OPENSSL_MODULES. It must never be loaded.
    OSSL_PROVIDER* external = OSSL_PROVIDER_load(ctx, "guardian_external_probe");
    if (external != nullptr) return 15;
#ifdef _WIN32
    if (GetModuleHandleW(L"guardian_external_probe.dll") != nullptr) return 15;
    char loaded[8] = {};
    if (GetEnvironmentVariableA("GUARDIAN_SENTINEL_LOADED", loaded, static_cast<DWORD>(sizeof(loaded))) != 0) return 16;
#else
    if (std::getenv("GUARDIAN_SENTINEL_LOADED") != nullptr) return 16;
#endif
    EVP_MD_CTX_free(operation);
    EVP_MD_free(digest);
    OSSL_PROVIDER_unload(provider);
    OSSL_LIB_CTX_free(ctx);
    std::puts("{\"schema\":\"metaengine.guardian.openssl-provider-probe.v1\",\"sha256_known_answer\":true,\"external_provider_rejected\":true,\"sentinel_not_loaded\":true,\"signature_verifier_tested\":false}");
    return 0;
}
