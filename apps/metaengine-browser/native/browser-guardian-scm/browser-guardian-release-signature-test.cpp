// Test-only translation unit. Includes the implementation to exercise its
// PRIVATE canonical recognizer/primitive. No test key/root override is exported
// by the separately compiled production object or its public header.
#include "browser-guardian-release-signature.cpp"
#ifdef NDEBUG
#error Native signature tests require assertions enabled
#endif
#include <cassert>
#include <iostream>
#include <type_traits>

using namespace metaengine::guardian;
namespace {
template<std::size_t N> std::array<std::uint8_t,N> hex(std::string_view text) {
    assert(text.size() == N * 2);
    std::array<std::uint8_t,N> out{};
    const auto digit = [](char c) { return c <= '9' ? c - '0' : c - 'a' + 10; };
    for (std::size_t i = 0; i < N; ++i) out[i] = static_cast<std::uint8_t>((digit(text[i*2]) << 4) | digit(text[i*2+1]));
    return out;
}
std::string canonical() {
    return "{\"schema\":\"metaengine.browser.installed-release-manifest.v2\",\"source_sha\":\"" + std::string(40,'a')
        + "\",\"package_version\":\"0.7.0-dev.12345.1\",\"exe_name\":\"METAENGINE Browser Test.exe\",\"exe_sha256\":\"" + std::string(64,'b')
        + "\",\"signer_thumbprint\":\"" + std::string(40,'c') + "\",\"installer_sha256\":\"" + std::string(64,'d')
        + "\",\"slsa_bundle_sha256\":\"" + std::string(64,'e') + "\",\"slsa_evidence_sha256\":\"" + std::string(64,'f')
        + "\",\"package_code_sha256\":\"" + std::string(64,'0') + "\"}";
}
void tests() {
    static_assert(!std::is_default_constructible_v<VerifiedReleaseSignatureV2>);
    // RFC8032 section7.1 test1: PUBLIC verification vector only. No private key
    // bytes, signing operation or generated production-root positive fixture.
    const auto publicKey=hex<32>("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    const auto signature=hex<64>("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555f"
        "b8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
    assert(verifyEd25519("",signature,publicKey));
    assert(!verifyEd25519("x",signature,publicKey));
    auto changed=signature;changed[0]^=1;assert(!verifyEd25519("",changed,publicKey));
    assert(!verifyEd25519("",signature,kReleasePublicKey));
    assert(!verifyEd25519(std::string(kDomain,sizeof(kDomain)-1),signature,publicKey));
    const auto message=canonical();
    assert(parseCanonicalManifest(message));
    assert(!verifyGuardianReleaseSignatureV2(message,signature));
    assert(!verifyGuardianReleaseSignatureV2(message,{}));
    assert(!parseCanonicalManifest(""));assert(!parseCanonicalManifest(std::string(2049,'a')));
    assert(!parseCanonicalManifest(message+"\n"));assert(!parseCanonicalManifest(message+"{}"));
    assert(!parseCanonicalManifest(" "+message));assert(!parseCanonicalManifest(message.substr(0,message.size()-1)));
    assert(!parseCanonicalManifest(message+std::string(1,'\0')));
    auto bad=message;bad.insert(1,"\"schema\":\"duplicate\",");assert(!parseCanonicalManifest(bad));
    bad=message;bad.insert(bad.size()-1,",\"verified\":true");assert(!parseCanonicalManifest(bad));
    bad=message;bad.replace(bad.find(std::string(40,'a')),1,"A");assert(!parseCanonicalManifest(bad));
    bad=message;bad.replace(bad.find("12345"),5,"1e100");assert(!parseCanonicalManifest(bad));
    bad=message;bad.replace(bad.find("12345"),5,"-1");assert(!parseCanonicalManifest(bad));
    bad=message;bad.replace(bad.find("12345"),5,"");assert(!parseCanonicalManifest(bad));
    bad=message;bad.replace(bad.find("METAENGINE Browser Test.exe"),26,"foreign.exe");assert(!parseCanonicalManifest(bad));
    bad=message;bad.replace(bad.find("METAENGINE"),1,"\\u004d");assert(!parseCanonicalManifest(bad));
    bad=message;bad.replace(bad.find("v2\""),2,"v1");assert(!parseCanonicalManifest(bad));
    const std::string material=std::string(kDomain,sizeof(kDomain)-1)+message;
    assert(material.find('\0')==std::string_view("METAENGINE_INSTALLED_RELEASE_MANIFEST_V2").size());
    assert(material[material.find('\0')+1]=='{');
    std::cout << "native_release_signature_checks=PASS; production_positive=UNAVAILABLE; loaded_code=NOT_ATTESTED\n";
}
}
int main(int argc, char** argv) {
    if(argc==2 && std::string_view(argv[1])=="--canonical") {
        std::string input;char c;
        while(std::cin.get(c)) { if(input.size()==2048)return 2;input.push_back(c); }
        const auto parsed=parseCanonicalManifest(input);if(!parsed)return 2;
        std::cout << std::string(kDomain,sizeof(kDomain)-1) << input;
        return 0;
    }
    if(argc==2 && std::string_view(argv[1])=="--public-spki") {
        constexpr unsigned char prefix[]={0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00};
        std::cout.write(reinterpret_cast<const char*>(prefix),sizeof(prefix));
        std::cout.write(reinterpret_cast<const char*>(kReleasePublicKey.data()),kReleasePublicKey.size());return 0;
    }
    if(argc!=1)return 2;
    tests();return 0;
}
