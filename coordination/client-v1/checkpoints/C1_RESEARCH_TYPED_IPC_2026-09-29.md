# C1 Research Checkpoint — Narrow Renderer Authority

Captured: 2026-09-29

External research after C1 confirms the Client V1 authority membrane:

- Electron context isolation keeps preload in an isolated world.
- Electron security guidance explicitly warns against exposing generic ipcRenderer.send/invoke over contextBridge.
- Recommended pattern is one narrow exposed method per intended IPC operation.

Client V1 consequence:
- future UI control must use typed intent methods such as submitGoal/pause/resume/approve/intervene/selectAgent;
- renderer must not receive generic command, arbitrary channel, eval, filesystem, SQL, process, or Browser-effect authority.

References:
- https://www.electronjs.org/docs/latest/tutorial/context-isolation
- https://www.electronjs.org/docs/latest/tutorial/ipc
- https://www.electronjs.org/docs/latest/tutorial/security

Status: RESEARCH_COMPLETE.
No release candidate bytes changed.
