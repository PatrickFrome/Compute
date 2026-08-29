from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "coordination" / "chat-control-plane" / "extension"


def read(name: str) -> str:
    return (EXT / name).read_text(encoding="utf-8")


def test_manifest_adds_gemini_only_as_advisory_observer() -> None:
    manifest = json.loads(read("manifest.json"))
    assert "https://gemini.google.com/*" in manifest["host_permissions"]
    gemini_scripts = [
        item for item in manifest["content_scripts"]
        if "https://gemini.google.com/*" in item.get("matches", [])
    ]
    assert len(gemini_scripts) == 1
    assert gemini_scripts[0]["js"] == ["gemini-advisory-observer.js"]
    assert "prompt-gate.js" not in gemini_scripts[0]["js"]


def test_background_loads_advisory_bridge_but_not_trusted_send() -> None:
    entry = read("background-entry.js")
    assert 'importScripts("./gemini-advisory-bridge.js")' in entry
    assert "trusted-gemini" not in entry.lower()


def test_gemini_observer_has_current_semantic_selectors_and_no_actuation() -> None:
    source = read("gemini-advisory-observer.js")
    for token in (
        "div.ql-editor[contenteditable='true']",
        "rich-textarea [contenteditable='true']",
        "user-query",
        "model-response",
        "GEMINI_GOOGLE",
        "authority_effect: false",
        "advisory_only: true",
    ):
        assert token in source
    for forbidden in ("chrome.debugger", "Input.dispatchKeyEvent", "Input.insertText", "tabs.update", "tabs.create"):
        assert forbidden not in source


def test_gemini_background_bridge_is_local_fail_closed() -> None:
    source = read("gemini-advisory-bridge.js")
    assert 'hostname.toLowerCase() === "gemini.google.com"' in source
    assert 'remoteDispatchEnabled: false' in source
    assert 'actuationEnabled: false' in source
    assert 'authorityEffect: false' in source
    for forbidden in ("fetch(", "A2_GEMINI_TRUSTED_SEND", "chrome.debugger", "chrome.tabs.create", "chrome.tabs.update"):
        assert forbidden not in source


def test_existing_remote_dispatch_still_rejects_gemini() -> None:
    source = read("background-v063.js")
    assert 'throw new Error("unsupported_target_platform")' in source
    assert 'command.target_platform==="GEMINI_GOOGLE"' not in source
