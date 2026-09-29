//! ME2 OS shell — library entry (Tauri 2 mobile-ready pattern).
//!
//! Sidecar: `binaries/me2-daemon-<target-triple>` собирается из
//! `mini-services/me2-daemon` командой `bun build --compile` (см.
//! .github/workflows/tauri-build.yml). Логи sidecar → app_data/sidecar.log.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Дескрипор дочернего процесса sidecar — для корректного kill при выходе.
struct SidecarHandle(Mutex<Option<CommandChild>>);

/// Блокирующий health-чек демона без внешних зависимостей (raw HTTP/1.0).
fn daemon_healthy() -> bool {
    if let Ok(mut s) = TcpStream::connect("127.0.0.1:3041") {
        let _ = s.set_read_timeout(Some(Duration::from_millis(700)));
        if s.write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").is_ok() {
            let mut buf = String::new();
            if s.read_to_string(&mut buf).is_ok() {
                return buf.contains("\"ok\":true");
            }
        }
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // второй запуск → просто фокус на существующее окно
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            // 1) sidecar me2-daemon
            let sidecar = app.shell().sidecar("me2-daemon")?;
            let (mut rx, child) = sidecar.spawn()?;
            app.manage(SidecarHandle(Mutex::new(Some(child))));

            // 2) логи sidecar → app_data/sidecar.log
            let app_dir = app.path().app_data_dir()?;
            let _ = std::fs::create_dir_all(&app_dir);
            tauri::async_runtime::spawn(async move {
                let mut log = std::fs::File::create(app_dir.join("sidecar.log")).ok();
                while let Some(ev) = rx.recv().await {
                    let line = match ev {
                        CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                            String::from_utf8_lossy(&b).to_string()
                        }
                        CommandEvent::Error(e) => format!("[sidecar-error] {e}"),
                        CommandEvent::Terminated(s) => {
                            format!("[sidecar-exit] code={:?}", s.code)
                        }
                        _ => continue,
                    };
                    if let Some(f) = log.as_mut() {
                        let _ = writeln!(f, "{line}");
                    }
                }
            });

            // 3) health-поллинг не нужен для редиректа (dist-страница поллит сама),
            //    но фиксируем состояние «демон не поднялся за 30с» для диагностики
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for i in 0..60 {
                    if daemon_healthy() {
                        break;
                    }
                    if i == 59 {
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.eval(
                                "document.dispatchEvent(new CustomEvent('me2-sidecar-down'))",
                            );
                        }
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 4) закрытие окна → корректный kill sidecar
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(h) = app.try_state::<SidecarHandle>() {
                    if let Ok(mut slot) = h.0.lock() {
                        if let Some(child) = slot.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("ME2 OS shell: не удалось запустить tauri-приложение");
}
