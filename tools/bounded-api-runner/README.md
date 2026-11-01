# Bounded Responses API runner

Recoverable source for a local Node 24+ runner. Uses built-in HTTPS and filesystem APIs only. Output is proposed code changes and test guidance, never automatically executed or applied. No credentials, prompts, outputs, receipts, historical accounting, or runtime state belong in Git.

## Restore and configure

1. Copy this directory into a private local working directory.
2. Restore existing runtime state from an authorized private backup if available. A source checkout is **not** an accounting or credential backup. Do not reset state or assume old spend was zero when restoring source.
3. The authorized operator separately provides the API key through `OPENAI_API_KEY`. The runner does not read `.env` or create keys. Credential recovery requires an independently authorized local copy; Git intentionally cannot recover it.
4. For a genuinely new run-state only, create ignored `private-init.json` with an explicitly approved positive integer `new_work_cap_micro` (micro-US dollars). Private historical context may also be included. An unavailable historical ledger must be reconciled by the operator before selecting the new-work ceiling. The ceiling is not an account balance.
5. Review every input file to exclude secrets, credentials, personal data and database data. Send only specifically authorized source snippets, tests and deidentified logs.

```sh
node --test runner.test.mjs
node runner.mjs init # once only; requires private config and refuses existing state
node runner.mjs --validate stable-logical-task /path/to/reviewed-prompt.txt 64000 high
# Paid: only after authorization, credential loading and availability checks
node runner.mjs run stable-logical-task /path/to/reviewed-prompt.txt 64000 high
```

Optional final CLI argument selects high, xhigh or max reasoning effort; default is max. Requested effort is recorded in admission, validation and receipts.

Default output limit is 32000 tokens, including reasoning; optionally specify up to 128000. Prompt limit is 200000 UTF-8 bytes. Validation does not load API credentials or perform network requests. The operator checks model availability separately; no paid probe is performed.

## Transport and outputs

Fixed HTTPS destination: `api.openai.com:443/v1/responses`; no redirects, retries or fallback provider. Node24 proxyEnv supports environment-configured proxies while preserving TLS destination verification. Requests use `gpt-6-astra`, explicit `reasoning.effort` (default max), `reasoning.mode=standard`, `service_tier=fast`, `prompt_cache_options.ttl=30m`, `store=false`, and no tools. Fast may report actual tier `priority` or be downgraded to `default`; receipts report the actual response values.

Absolute request deadline is 1800 seconds; total received stream limit is 32 MiB. The parser handles arbitrary byte boundaries and waits for exactly one terminal event followed by valid EOF. A known incomplete/failed terminal with valid usage and EOF can settle accounting without becoming a successful task. Missing final text remains a non-success outcome. Duplicate terminal, malformed data, HTTP error, disconnect or timeout keeps accounting unknown. No automatic retry occurs, even on rate limiting.

Progress rows record admission and response-created ID. Created IDs are additionally written and fsynced locally as soon as observed so later stream loss does not erase them. Artifacts are `outputs/TASK.txt` (completed assistant final text only) and `outputs/TASK.receipt.json` (selected actual model/tier, IDs, token usage and generic outcome). Raw HTTP/SSE errors and authorization headers are never logged. Interrupted execution may still incur cost.

## Temporary concurrency guard

All runner processes in the same directory share one state and atomic mkdir mutex. Admission atomically checks both max20 live requests and configured new-work ceiling. Stable logical task keys suppress repeat submission regardless of prior result. Refused jobs are neither queued nor retried automatically.

Worst-case input tokens are UTF-8 bytes plus a framing allowance, kept below the long-context threshold. Accounting deliberately charges all input at the configured 30-minute cache-write worst-case total rate (currently $25/M for Astra Fast) and output at $100/M, ignoring cache discounts. Validated terminal usage with confirmed EOF frees unused live headroom independently of task success. Unknown requests retain their worst-case exposure pending evidence-based reconciliation; this is not a claim of actual expense or a permanent prepaid reservation.

A killed process can leave a lock or an in-flight row. Never delete them to force resubmission: first establish process/request outcome. The CLI intentionally has no reset/retry/forgive operation. A new checkout must not be used to bypass shared accounting or duplicate detection.

The private state, private-init.json, outputs and .env files are ignored. Never force-add them. The historical-accounting-unavailable marker is intentional and is not a restored ledger.

## Verification and references

Offline tests use fake HTTPS and disposable temporary state, with no credentials or API traffic. Coverage includes streaming boundaries, UTF-8, malformed/oversized streams, terminal validation, deadlines, sanitized errors, duplicate suppression, atomic budget admission, successful headroom release, unknown retention and concurrency ceilings.

Documentation checked when this runner was prepared:
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/reference/resources/responses/streaming-events
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/docs/guides/rate-limits
- https://developers.openai.com/api/docs/pricing

Reverify current pricing and model parameters before future reuse. Concurrency admission does not guarantee project RPM/TPM availability.

## Optional official token-count preflight

For a new, not-yet-submitted logical task, the authorized operator may run:

```sh
node runner.mjs count stable-logical-task /path/to/reviewed-prompt.txt 16000 high
node runner.mjs --validate stable-logical-task /path/to/reviewed-prompt.txt 16000 high
# Separate authorized generation; count never dispatches generation automatically:
node runner.mjs run stable-logical-task /path/to/reviewed-prompt.txt 16000 high
```

Counting uses only `POST https://api.openai.com/v1/responses/input_tokens`, with identical model, input, instructions and tools. It has a 60-second absolute deadline, 1 MiB response limit, the same proxy configuration, no redirects and no retries. Count receipts are private ignored `outputs/TASK.count.json` files containing only selected metadata and a SHA-256 binding to the complete generation request. Prompt bytes, instructions, model, tools, effort and output limit must remain unchanged between count and generation. Counts cannot be supplied as arbitrary CLI numbers.

A validated count plus 4096 tokens of margin can reduce the input allowance, never increase output allowance or total cap. Without a count receipt, the byte-based allowance remains. An invalid or mismatched existing receipt blocks generation; a failed count never silently dispatches generation. Prior admitted requests are not modified. Count receipts are trusted local artifacts: do not manually edit or copy them between tasks.

Reference: https://developers.openai.com/api/docs/guides/token-counting and https://developers.openai.com/api/reference/resources/responses/subresources/input_tokens/methods/count
