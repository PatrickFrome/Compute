/**
 * ME2 CHAT-SWARM v1.4.0 — tier.ts
 * Единая tier-оценка качества модели по имени (0-100).
 * Используется llm.ts (порядок цепочки), colab.ts (узлы GPU) и model-scout.ts
 * (разведка внешних каталогов). Один источник истины — ноль циклических импортов.
 */

export function tierScore(name: string): number {
  const n = (name ?? "").toLowerCase();
  if (/gpt-5|o3|o4-mini/.test(n)) return 96;
  if (/claude-(4|opus|sonnet)/.test(n)) return 94;
  if (/gemini-(2\.5|3)/.test(n)) return 92;
  if (/glm-(4\.[5-9]|5)/.test(n)) return 90;
  if (/deepseek-v[4-9]/.test(n)) return 93; // v1.4.1: deepseek-v4-pro/flash (CF-каталог)
  if (/deepseek-(r1|v3)/.test(n)) return 89;
  if (/qwen-(2\.5-)?7[2-9]|qwen3/.test(n)) return 86;
  if (/llama-4|llama-3\.3-70|llama-70b/.test(n)) return 85;
  if (/phi-?4/.test(n)) return 75;
  if (/gpt-4o|gpt-4\.1/.test(n)) return 82;
  if (/gpt-oss-120b/.test(n)) return 72; // v1.4.1: gpt-oss-120b заметно сильнее 20b
  if (/mistral-(large|nemo)/.test(n)) return 65;
  if (/gemma-?3-?12|gemma-?3-?27/.test(n)) return 70;
  if (/gemma/.test(n)) return 50;
  if (/qwen2?\.?5-14/.test(n)) return 60;
  if (/gpt-oss-20b|openai-fast/.test(n)) return 55;
  if (/llama-3\.1-8b|llama-8b/.test(n)) return 40;
  return 35;
}
