import { Me2Shell } from "@/components/me2/shell/me2-shell";

const FILES = [
  {
    href: "/zai-chat-export/zai-chat-export-chrome-extension.zip",
    label: "Chrome-расширение (.zip)",
    hint: "основное — MV3, кнопка + popup + Ctrl+Shift+Y",
    primary: true,
  },
  {
    href: "/zai-chat-export/zai-chat-export-console.js",
    label: "Консольный скрипт (.js)",
    hint: "разовый экспорт через DevTools",
    primary: false,
  },
  {
    href: "/zai-chat-export/zai-chat-export.user.js",
    label: "Tampermonkey-скрипт (.user.js)",
    hint: "альтернатива расширению",
    primary: false,
  },
];

export default function Page() {
  return (
    <>
      <Me2Shell />
      <aside
        aria-label="Загрузка инструмента экспорта чата Z.ai"
        className="fixed bottom-14 left-4 z-[9999] w-64 rounded-xl border border-white/10 bg-gray-900/95 p-3 text-gray-100 shadow-xl backdrop-blur"
      >
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
          Z.ai Chat Export v1.0.1
        </p>
        <ul className="space-y-1.5">
          {FILES.map((f) => (
            <li key={f.href}>
              <a
                href={f.href}
                download
                className={
                  "flex flex-col rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-white/10 " +
                  (f.primary ? "bg-emerald-600/90 font-semibold text-white hover:bg-emerald-600" : "text-gray-200")
                }
              >
                <span>⬇ {f.label}</span>
                <span className={"text-[10px] " + (f.primary ? "text-emerald-100" : "text-gray-400")}>{f.hint}</span>
              </a>
            </li>
          ))}
        </ul>
        <a
          href="/zai-chat-export/chrome-extension-install-ru.md"
          download
          className="mt-2 block text-[10px] text-gray-400 underline hover:text-gray-200"
        >
          Инструкция по установке (RU)
        </a>
        <p className="mt-1 text-[10px] leading-snug text-gray-500">
          Если скачивание в панели заблокировано — «Open in New Tab» и добавьте к адресу путь файла.
        </p>
      </aside>
    </>
  );
}
