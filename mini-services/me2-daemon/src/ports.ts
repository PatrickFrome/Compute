// ── R51 (фаза C, план C6): изоляция инстансов для gate-probe и песочниц ──
// План: «autorelease-gate с npm run check + eval» — CI поднимает изолированный
// инстанс daemon'а (свои порты + свой DATA_DIR) и требует eval verdict=PASS.
// По умолчанию значения = production-контракт me2-daemon-contract.v1 (3040/3041),
// поэтому поведение живой системы не меняется ни на бит.
// Аналог: VS Code server --port / code-server --bind-addr (тот же приём изоляции).
export const WS_PORT = Number(process.env.ME2_WS_PORT ?? 3040);
export const REST_PORT = Number(process.env.ME2_REST_PORT ?? 3041);
/** Каталог данных (SQLite me2.db): по умолчанию — data/ рядом с daemon'ом. */
import { join } from "node:path";

export const DATA_DIR: string | null = process.env.ME2_DATA_DIR ?? null;
/** Корень dev-репозитория (R51: env ME2_REPO_ROOT — CI/monorepo-укладки без /home/z). */
export const REPO_ROOT = process.env.ME2_REPO_ROOT ?? "/home/z/my-project";
/** Корень рабочих каталогов чатов (agentchat). */
export const CHAT_ROOT = process.env.ME2_CHAT_ROOT ?? join(REPO_ROOT, "me2-workspace");
