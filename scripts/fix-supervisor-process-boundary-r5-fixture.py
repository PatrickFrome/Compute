from pathlib import Path

p = Path('apps/metaengine-browser/test/supervisor-process-boundary-ambiguity-r5.test.mjs')
text = p.read_text(encoding='utf-8')
replacements = [
    (
        "  const actions = [];\n  let typed = 0;\n",
        "  const actions = [];\n  let typed = 0;\n  let currentTabs = structuredClone(tabs);\n",
    ),
    (
        "    if (action === 'CAPTURE') return rootFrame();\n",
        "    if (action === 'CAPTURE') {\n      const tab = currentTabs.find((row) => String(row?.tab_id || '') === String(payload?.tab_id || ''));\n      return { ...rootFrame(), url: String(tab?.url || 'https://chatgpt.com/'), tab_id: String(payload?.tab_id || '') };\n    }\n",
    ),
    (
        "      typed += 1;\n      return {\n",
        "      typed += 1;\n      currentTabs = currentTabs.map((row) => String(row?.tab_id || '') === String(payload?.tab_id || '')\n        ? { ...row, url: 'https://chatgpt.com/c/r5-recovered' }\n        : row);\n      return {\n",
    ),
    (
        "    getState: async () => ({ tabs: structuredClone(tabs), fleet: { agents: [] } }),\n",
        "    getState: async () => ({ tabs: structuredClone(currentTabs), fleet: { agents: [] } }),\n",
    ),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f'fixture replacement expected one match, got {text.count(old)}: {old!r}')
    text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('fixed R5 test fixture URL transition')
