# Chat coordination, native implementation, independent review

## Scope and current evidence

The user wants ordinary coordinated chat agents to own planning and ongoing
project work, with Codex CLI as a code execution tool and CRITIC as an independent
review role. A CLI-only success is not acceptance of that goal. Windows VM work
was cancelled; do not restart it. Existing installed .225 and PostgreSQL/Guardian
must not be modified merely to run source tests.

The current main submitClientGoal chooses BROWSER or NATIVE_CODING from protected
profile presence. These are separate submission paths, not a proven handoff
between chat planning and native execution. The chat roster is not a native run
roster. Native seed SQL, task leases, result/critic/checkpoint handling and the
existing Host tools must remain the authority for physical effects.

## Research, consulted 2026-10-29

- OpenAI, Codex as a platform: https://developers.openai.com/blog/codex-as-a-platform
  The official integration choices distinguish bounded noninteractive exec jobs
  from persistent application conversations and streamed lifecycle events via
  app-server. Keep the existing exec transport while qualifying this client;
  replacing it with app-server is a separate migration, not evidence that normal
  ChatGPT browser sessions have started working.
- LangGraph persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
  Separate per-run checkpoints from shared cross-conversation project knowledge.
  Our own PostgreSQL already owns these records; adopting the concept does not
  require another database or a new orchestration framework.
- LangGraph workflow design: https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph
  Small stages make failures and recovery boundaries observable. Never copy a
  generic retry policy onto an uncertain write; reconcile its durable effect.
- Anthropic multi-agent research: https://www.anthropic.com/research/multi-agent-research-system
  Distinct delegation objectives, interfaces and result formats avoid duplicate
  work. Research parallelism results are not proof of coding-agent performance.

## Delivery plan and acceptance

1. Preserve the private request deadline/cancellation through native admission.
   Implemented first slice; physical read cancellation/performance remains open.
2. Show chat readiness separately from native goal admission/execution. Do not
   infer CLI work from a browser tab count or infer chat dispatch from a SQL seed.
3. Trace existing chat task/result producers to the authenticated project task
   APIs. Add the minimal typed handoff through existing Host/lease authority:
   project, parent task, proposing chat actor, plan revision and correlation ID.
   Treat model plans as untrusted proposals until normal Host validation.
4. One durable task history must show: proposal, accepted assignment, worker
   start, result receipt, independent CRITIC verdict, checkpoint and successor.
   The UI must show pending/unknown and the exact stage without optimistic DONE.
5. Test distinct IMPLEMENTER and CRITIC workspaces/identities, negative review,
   repair loop, durable message delivery/read acknowledgement, and child task
   creation. Verify a new task follows the accepted checkpoint exactly once.
6. Interrupt each boundary and restart. A lost response cannot create duplicate
   sends or admits. A cancelled request cannot dispatch late admission SQL.
7. Run an actual small project through chat -> CLI -> CRITIC -> checkpoint ->
   next task on the installed client. Source fixtures alone cannot close this.

No fixed ceiling on logical agent count is introduced. Active workers still
need resource admission and queues; it is not possible to promise unlimited
simultaneous processes or model capacity.

## Current implementation status

Private admission lifetime: focused71pass. UI route wording:16 source/projection
checks and30 goal UI/observer tests pass; TypeScript noEmit passes. UI changes
clarify existing routes, not claim the missing cross-route handoff is complete.
No new installer, live send, private credentials or user PC changes performed.
