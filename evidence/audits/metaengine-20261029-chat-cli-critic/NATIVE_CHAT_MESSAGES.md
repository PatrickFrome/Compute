# Native worker messages to chat coordinators

The existing native agent_send_message SQL resolver previously joined every
recipient to a native permit, so it could not address the browser PLANNER even
inside the same project. The checked additive migration retains native peers
and accepts browser peers with an exact current active claim, or a matching
protected suspension record and closed prior claim. Foreign, absent, expired
and ambiguous peers remain refused. The resolver is private and not granted to
API roles; sender authorization and existing durable intent/semantic dedupe are
unchanged. No new scheduler, model transport or execution permission is added.

Actual disposable PG17 regression first failed with native_agent_recipient_not_unique.
After the repair, the chat-led writer stores a message to its planner once,
exact replay returns the saved receipt, and the existing project history API
reads the complete text. Foreign and expired-claim negatives pass. A generated
suspended-recipient transaction checks storage routing and rolls back; this does
not qualify physical browser suspension. The message remains untrusted project
data and read_by_recipient_proven=false.

The MCP description now makes the boundary explicit: storing a message does not
wake a suspended chat or prove that it was read. Automatic message wake and a
browser-to-native message action are not implemented in this slice. Existing
PROJECT_HISTORY supplies shared readback; this is not a live chat/model test.
