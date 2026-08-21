import copy
import hashlib
import json
import re
import unittest

CONTRACT_SHA256 = "05f3f28e1e57250c77d37338150ee1e3f4efcb0d0772444e9865ee9e9f4a203e"
EXPECTED_AMD64 = "28a1bc1546b4da92832e8911083324d144e5b0fecf96f85fe475d10c275b0228"
EXPECTED_ARM64 = "17c7016e83d534e8c34754e8707bf0a7514da7838f2fb550f3ff25d986113411"
ALLOWED_ENV = ("PATH", "LC_ALL", "TZ", "SOURCE_DATE_EPOCH")
ALLOWED_NAMES = {
    "compiler.c": {"clang", "gcc"},
    "compiler.cxx": {"clang++", "g++"},
    "compiler.rust": {"rustc"},
    "compiler.go": {"go"},
    "runtime.python": {"python", "python3"},
    "runtime.node": {"node"},
    "runtime.jvm": {"java"},
    "linker": {"lld", "ld", "ld.lld", "gold"},
    "archiver": {"llvm-ar", "ar"},
    "build.bazel": {"bazel", "bazelisk"},
    "build.cmake": {"cmake"},
    "build.ninja": {"ninja"},
    "build.make": {"make"},
    "package.cargo": {"cargo"},
    "package.npm": {"npm"},
    "package.pnpm": {"pnpm"},
    "package.yarn": {"yarn"},
    "package.pip": {"pip", "pip3"},
    "package.uv": {"uv"},
    "package.go": {"go"},
}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


def canonical_json(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        raise ValueError("numbers are forbidden in canonical identity JSON")
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str) or not key or any(ord(ch) < 32 or ord(ch) > 126 for ch in key):
                raise ValueError("canonical identity keys must be printable ASCII")
        return "{" + ",".join(
            json.dumps(k, ensure_ascii=False) + ":" + canonical_json(value[k])
            for k in sorted(value)
        ) + "}"
    raise ValueError(f"unsupported JSON type: {type(value).__name__}")


def _exact_keys(obj, allowed, label):
    unknown = set(obj) - set(allowed)
    if unknown:
        raise ValueError(f"unknown {label} field(s): {sorted(unknown)}")


def derive_toolchain_identity(descriptor):
    if not isinstance(descriptor, dict):
        raise ValueError("descriptor must be object")
    _exact_keys(
        descriptor,
        {"schema", "runtime", "tools", "lockfiles", "dependencies", "platform", "environment", "execution_parameters"},
        "top-level",
    )
    if descriptor.get("schema") != "metaengine.compute.toolchain-identity-input.h205f22.v3":
        raise ValueError("schema mismatch")

    runtime = descriptor.get("runtime")
    if not isinstance(runtime, dict):
        raise ValueError("runtime required")
    _exact_keys(runtime, {"kind", "digest", "version"}, "runtime")
    if runtime.get("kind") not in {"OCI_IMAGE", "HOST_FINGERPRINT"}:
        raise ValueError("runtime kind invalid")
    if not DIGEST.fullmatch(runtime.get("digest", "")):
        raise ValueError("runtime digest invalid")
    if not runtime.get("version"):
        raise ValueError("runtime version required")

    tools = descriptor.get("tools")
    if not isinstance(tools, list) or not tools:
        raise ValueError("non-empty tools required")
    seen_tools = set()
    normalized_tools = []
    for tool in tools:
        if not isinstance(tool, dict):
            raise ValueError("tool entry must be object")
        _exact_keys(tool, {"role", "name", "version", "sha256"}, "tool")
        role, name = tool.get("role"), tool.get("name")
        if role not in ALLOWED_NAMES:
            raise ValueError(f"unknown tool role: {role}")
        if name not in ALLOWED_NAMES[role]:
            raise ValueError(f"unknown tool name for {role}: {name}")
        if not tool.get("version") or not HEX64.fullmatch(tool.get("sha256", "")):
            raise ValueError("tool version/sha256 required")
        identity = (role, name)
        if identity in seen_tools:
            raise ValueError("duplicate tool role/name")
        seen_tools.add(identity)
        normalized_tools.append(copy.deepcopy(tool))
    normalized_tools.sort(key=lambda t: (t["role"], t["name"], t["version"], t["sha256"]))

    lockfiles = descriptor.get("lockfiles")
    if not isinstance(lockfiles, list):
        raise ValueError("lockfiles must be array")
    seen_paths = set()
    normalized_lockfiles = []
    for item in lockfiles:
        if not isinstance(item, dict):
            raise ValueError("lockfile entry must be object")
        _exact_keys(item, {"path", "sha256"}, "lockfile")
        if not item.get("path") or not HEX64.fullmatch(item.get("sha256", "")):
            raise ValueError("lockfile path/sha256 required")
        if item["path"] in seen_paths:
            raise ValueError("duplicate lockfile path")
        seen_paths.add(item["path"])
        normalized_lockfiles.append(copy.deepcopy(item))
    normalized_lockfiles.sort(key=lambda x: (x["path"], x["sha256"]))

    dependencies = descriptor.get("dependencies")
    if not isinstance(dependencies, list):
        raise ValueError("dependencies must be array")
    normalized_dependencies = []
    for item in dependencies:
        if not isinstance(item, dict):
            raise ValueError("dependency entry must be object")
        _exact_keys(item, {"uri", "digest"}, "dependency")
        if not item.get("uri") or not DIGEST.fullmatch(item.get("digest", "")):
            raise ValueError("dependency uri/sha256 required")
        normalized_dependencies.append(copy.deepcopy(item))
    normalized_dependencies.sort(key=lambda x: (x["uri"], x["digest"]))

    platform = descriptor.get("platform")
    if not isinstance(platform, dict) or not platform.get("os") or not platform.get("arch"):
        raise ValueError("platform os+arch required")
    if any(not isinstance(v, str) for v in platform.values()):
        raise ValueError("platform values must be strings")

    env = descriptor.get("environment")
    if not isinstance(env, dict):
        raise ValueError("environment required")
    if set(env) != set(ALLOWED_ENV):
        raise ValueError("environment keys must exactly match allowlist")
    if any(not isinstance(v, str) or not v for v in env.values()):
        raise ValueError("environment values must be non-empty strings")
    if not re.fullmatch(r"[0-9]+", env["SOURCE_DATE_EPOCH"]):
        raise ValueError("SOURCE_DATE_EPOCH must be integer string")

    execution = descriptor.get("execution_parameters")
    if not isinstance(execution, dict) or any(not isinstance(v, str) for v in execution.values()):
        raise ValueError("execution_parameters must be object<string,string>")

    body = {
        "schema": "metaengine.compute.toolchain-identity.h205f22.v3",
        "contract_key": "hermetic-v3",
        "contract_sha256": CONTRACT_SHA256,
        "runtime": copy.deepcopy(runtime),
        "tools": normalized_tools,
        "lockfiles": normalized_lockfiles,
        "dependencies": normalized_dependencies,
        "platform": copy.deepcopy(platform),
        "environment": copy.deepcopy(env),
        "execution_parameters": copy.deepcopy(execution),
    }
    digest = hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()
    return body | {
        "toolchain_digest": digest,
        "toolchain_identity_sha256": digest,
        "canonicalization": "METAENGINE_CANONICAL_JSON_V1",
        "cache_safe_identity": True,
        "canonical": False,
        "authority_effect": False,
    }


def assert_toolchain_identity(descriptor, expected):
    if not HEX64.fullmatch(expected or ""):
        raise ValueError("expected digest invalid")
    actual = derive_toolchain_identity(descriptor)
    if actual["toolchain_digest"] != expected:
        raise ValueError("toolchain digest mismatch")
    return actual


def fixture():
    return {
        "schema": "metaengine.compute.toolchain-identity-input.h205f22.v3",
        "runtime": {"kind": "OCI_IMAGE", "digest": "sha256:" + "1" * 64, "version": "ubuntu-24.04"},
        "tools": [
            {"role": "compiler.c", "name": "clang", "version": "18.1.8", "sha256": "2" * 64},
            {"role": "build.ninja", "name": "ninja", "version": "1.12.1", "sha256": "3" * 64},
        ],
        "lockfiles": [
            {"path": "Cargo.lock", "sha256": "4" * 64},
            {"path": "pnpm-lock.yaml", "sha256": "5" * 64},
        ],
        "dependencies": [
            {"uri": "pkg:cargo/serde@1.0.219", "digest": "sha256:" + "6" * 64},
            {"uri": "pkg:npm/typescript@5.9.2", "digest": "sha256:" + "7" * 64},
        ],
        "platform": {"os": "linux", "arch": "amd64", "libc": "glibc-2.39"},
        "environment": {"PATH": "/toolchain/bin", "LC_ALL": "C.UTF-8", "TZ": "UTC", "SOURCE_DATE_EPOCH": "0"},
        "execution_parameters": {"target": "x86_64-unknown-linux-gnu", "optimization": "release", "lto": "thin"},
    }


class ToolchainIdentityV3Test(unittest.TestCase):
    def test_reproducible_vector(self):
        d = fixture()
        self.assertEqual(derive_toolchain_identity(d)["toolchain_digest"], EXPECTED_AMD64)
        d["tools"].reverse()
        d["lockfiles"].reverse()
        d["dependencies"].reverse()
        self.assertEqual(derive_toolchain_identity(d)["toolchain_digest"], EXPECTED_AMD64)

    def test_cross_platform_vector(self):
        d = fixture()
        d["platform"]["arch"] = "arm64"
        self.assertEqual(derive_toolchain_identity(d)["toolchain_digest"], EXPECTED_ARM64)
        self.assertNotEqual(EXPECTED_AMD64, EXPECTED_ARM64)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            assert_toolchain_identity(d, EXPECTED_AMD64)

    def test_binding_mutations(self):
        for path, value in [
            (("tools", 0, "version"), "18.1.9"),
            (("lockfiles", 0, "sha256"), "8" * 64),
            (("execution_parameters", "optimization"), "debug"),
        ]:
            d = fixture()
            target = d
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.assertNotEqual(derive_toolchain_identity(d)["toolchain_digest"], EXPECTED_AMD64)

    def test_unknown_tool_name_rejected(self):
        d = fixture()
        d["tools"][0]["name"] = "evilcc"
        with self.assertRaisesRegex(ValueError, "unknown tool name"):
            derive_toolchain_identity(d)

    def test_unknown_tool_role_rejected(self):
        d = fixture()
        d["tools"][0]["role"] = "compiler.zig"
        with self.assertRaisesRegex(ValueError, "unknown tool role"):
            derive_toolchain_identity(d)

    def test_unknown_env_rejected(self):
        d = fixture()
        d["environment"]["HOME"] = "/tmp"
        with self.assertRaisesRegex(ValueError, "allowlist"):
            derive_toolchain_identity(d)

    def test_unknown_top_level_rejected(self):
        d = fixture()
        d["ambient"] = "forbidden"
        with self.assertRaisesRegex(ValueError, "unknown top-level"):
            derive_toolchain_identity(d)

    def test_malformed_runtime_digest_rejected(self):
        d = fixture()
        d["runtime"]["digest"] = "sha256:deadbeef"
        with self.assertRaisesRegex(ValueError, "runtime digest"):
            derive_toolchain_identity(d)


if __name__ == "__main__":
    unittest.main()
