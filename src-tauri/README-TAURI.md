# ME2 OS — Tauri 2 Shell (M3)

Шелл из DEVOS-blueprint: **окно Mission Control + sidecar me2-daemon + self-update**.
Никакого Electron: Tauri 2 даёт −96% к весу бандла, −75% RAM, ~3.7× быстрее старт.
Управляемый браузер — ОТДЕЛЬНЫЙ Chromium (daemon/CDP :3042), шелл его не содержит.

## Структура

```
src-tauri/
├── Cargo.toml            # tauri 2 + shell/updater/single-instance плагины
├── tauri.conf.json       # окно + externalBin sidecar + updater (GitHub Releases)
├── capabilities/         # минимальные IPC-правила (консоль ходит в daemon по HTTP)
├── src/main.rs           # вход
├── src/lib.rs            # sidecar spawn → health-поллинг → kill on exit
├── dist/index.html       # fallback-страница: поллит health, редиректит в MC
├── icons/icon.png        # источник; остальные генерит `cargo tauri icon`
└── binaries/             # СКОМПИЛИРОВАННЫЙ sidecar (bun --compile), в git НЕ входит
```

## Сборка локально

Требуется: bun ≥ 1.1, Rust ≥ 1.77, [tauri-cli v2](https://tauri.app).

```bash
# 1) sidecar: standalone-бинарник демона (ноль зависимостей на целевой машине)
cd mini-services/me2-daemon && bun install
bun build --compile index.ts \
  --outfile ../../src-tauri/binaries/me2-daemon-$(rustc -vV | awk '/host:/ {print $2}')

# 2) иконки из источника
cargo tauri icon src-tauri/icons/icon.png

# 3) dev-запуск / сборка бандлов (deb/msi/app.dmg)
cargo tauri dev
cargo tauri build
```

Sidecar-нейминг обязателен: `tauri.conf.json → bundle.externalBin: binaries/me2-daemon`
резолвит `me2-daemon-<target-triple>`.

## Self-update (updater)

1. Ключи: `cargo tauri signer generate -w ~/.tauri/me2.key`
2. Публичный ключ → `tauri.conf.json → plugins.updater.pubkey`
3. Приватный ключ в CI secret `TAURI_SIGNING_PRIVATE_KEY` (+ `..._PASSWORD`)
4. `bundle.createUpdaterArtifacts: true` → при релизе публикуется `latest.json`
5. Endpoints уже указаны на `PatrickFrome/Compute` Releases latest.

## CI

`.github/workflows/tauri-build.yml` — матрица ubuntu-22.04 / macos-14 / windows-2022:
bun install → `bun build --compile` sidecar под target-triple → `cargo tauri icon`
→ `tauri build` (updater-артефакты подписаны, если секрет задан) → upload artifact;
на тегах `v*` — GitHub Release + `latest.json` через tauri-action.

## Почему так (ссылки на ресёрч)

- research/2026/s16-tauri2-2026.json, s19-shell-benchmarks.json — сравнение шеллов.
- research/2026/METAENGINE-2-BLUEPRINT.md — «Шелл = консоль, браузер = отдельный CDP-процесс».
- research/2026/METAENGINE-DEVOS-ANALYSIS.md — updater вместо Resilience Plane (~7400 строк → ~50).
