// ME2 OS — Tauri 2 shell (M3, R17).
// Архитектура из DEVOS-анализа: шелл = ТОЛЬКО консоль. Управляемый Chromium —
// отдельный процесс (daemon/CDP), здесь не живёт. Обязанности шелла:
//   1) поднять sidecar me2-daemon (bun --compile, externalBin),
//   2) дождаться /health на :3041 и сообщить окну,
//   3) окно = Mission Control (http://127.0.0.1:3041),
//   4) single instance,
//   5) при закрытии — корректно убить sidecar,
//   6) updater (tauri-plugin-updater) — A/B self-update из GitHub Releases.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    me2_shell_lib::run()
}
