# METAENGINE Project Router

Keep this file small enough to remain useful even when the project evolves rapidly.

## Rule 1

**GitHub + Supabase live readback are the source of truth for current development state.**

Project files/chats/capsules are historical unless revalidated.

## Rule 2

On "continue development":

1. read `docs/chat-development-os/README.md`;
2. run `LIVE_PREFLIGHT_PROTOCOL.md`;
3. build the multi-frontier drift table from `FRONTIER_MODEL.md`;
4. select one bounded objective;
5. work against exact live identities;
6. persist `CHAT_HANDOFF_V1` to the active PR/issue.

## Rule 3

Never use an old snapshot file as a replacement for:
- current branch head;
- exact CI;
- installed Browser state;
- live Supabase authority;
- Edge version;
- actuation lease;
- task state;
- release/promotion state.

## Rule 4

A long or broken chat is disposable.

The next chat can reconstruct state from GitHub/Supabase plus the active PR/issue handoff.
