# DevFleet Direct MCP V1 — private Windows tunnel

Status: local MCP and native fleet.list confirmed; ChatGPT tunnel connection and actual Send not yet proven.

Design: ChatGPT custom MCP → OpenAI Secure MCP Tunnel → local Windows tunnel-client → stdio MCP script → authenticated 127.0.0.1 DevFleet RPC. No public port, no npm dependencies, no DevFleet reinstall.

## Exact proof (2026-10-13)

- Installed DevFleet 0.1.0-dev.9.20261013.1, PID 15220, bootstrap READY, 13 sessions.
- Windows Node v24.19.0; bridge passes node --check.
- MCP initialize: PASS, protocol 2025-06-18. tools/list: 7 tools. tools/call fleet_list: PASS, session_count 13.
- No new tabs, no ChatGPT Send and no installed profile writes.
- Official OpenAI tunnel-client v0.0.15 Windows AMD64 ZIP verified against GitHub release SHA256 3B53133A1E24D43F63088D843860CB1701A4C3ED6390DE2E19F69089E43BDDC1.
- Binary installed at %LOCALAPPDATA%\METAENGINE-DevFleet-MCP\bin-v0.0.15\tunnel-client.exe.

## One-time setup by the Windows account owner

1. Create a private OpenAI Platform tunnel at https://platform.openai.com/settings/organization/tunnels and associate it with the intended ChatGPT workspace. Creating it requires Tunnels Read + Manage.
2. Create a dedicated runtime API key with Tunnels Read + Use (not an Admin key). Never paste it into ChatGPT or a remote tool log.
3. In your local Windows PowerShell run this command, replacing only the tunnel ID:

    & 'C:\Users\User\Desktop\metaen\devfleet-direct-mcp-worktree\apps\metaengine-devfleet\scripts\connect-devfleet-tunnel.ps1' -TunnelId 'tunnel_YOUR_TUNNEL_ID'

   The script securely prompts for the runtime key in the local terminal, initializes profile metaengine-devfleet, runs doctor --explain, and then starts tunnel-client in the foreground. Keep the terminal running for initial testing.
4. In https://chatgpt.com/plugins choose + → Add custom MCP server. Name METAENGINE DevFleet Direct; under Connection choose Tunnel and select the newly created tunnel. Do not configure public inbound routing. Review authorization and write tool permissions.
5. In ordinary Chat, select the newly connected plugin and call fleet_list. Check for the same 13 sessions, then consider fleet_create and fleet_assign_batch using unique durable request IDs.

## Safety

- AMBIGUOUS sends must never be blindly retried. Quiet hints do not prove completion.
- MCP tool calls only expose known DevFleet RPC methods; never raw shell, SQL, CDP, arbitrary paths, local RPC bearer or developer-console mutation.
- The user confirmed model selection for new Chat tabs; nevertheless actual writable MCP tool permission must be proven after app connection. Seeing Add custom MCP server does not by itself establish write capability.
- A background/service supervisor can be added only after this connection is proven. Current first-run tunnel is foreground to simplify recovery.