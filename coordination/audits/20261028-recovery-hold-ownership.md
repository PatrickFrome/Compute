# Separate active recovery ownership from a retained journal fence

Three executable regressions reproduced races in the actual native Supervisor
hold methods: a successful journal read could clear an ongoing operation's hold;
and completion or pre-archive rejection could clear a new journal fence that
arrived during the operation.

The existing aggregate mutation gate now combines two private states: active
operation ownership and a retained journal/error fence. Journal readback only
updates the latter. Operation cleanup only releases its active ownership and
preserves any retained fence. Unknown apply errors retain a fence; validation
rejection before archive may release only the operation's own hold. No new
scheduler, admission authority, replay or broader mutation surface is added.

All three regressions failed on the prior code. Combined interrupted recovery,
actual main lifetime and startup independence suites:69pass0fail0skip on Linux.
Installed Windows and native retest for these new changes remain pending.

Follow-up admission boundary checks found three more missing distinctions:
- a retained fence arriving while maintenance drains must prevent operation entry;
- a retained fence by itself cannot authorize the Supervisor mutation;
- a new retained fence during an active operation must block that native mutation.
All three new negative cases failed before the follow-up. The valid active
operation still invokes the mutation once. The native mutation now requires
active ownership and no retained fence, and operation entry rechecks retained
state after the asynchronous drain. Combined recovery suites:101tests99pass,
0fail,2Windows-only skips. No replay, bypass or journal deletion is introduced.
