# F1 Model Gateway — Zero-Spend Privacy Hardening (2026-08-29)

Status: PREPARE_ONLY. `authority_effect=false`. No F1 completion claim, deployment, paid inference, or Supabase DDL.

## Finding

The Vercel AI Gateway live model catalog distinguishes price from privacy. The three zero-spend routes used by this branch currently report input/output price zero, but they do not all advertise the same privacy properties and none of the three should be treated as a confidential-data channel merely because inference price is zero.

Observed live catalog metadata at research time:

- `minimax/minimax-m3-free`: `zdr=none`, `no_training=none`; published input/output tiers are zero.
- `poolside/laguna-s-2.1-free`: `zdr=none`, `no_training=none`; headline input/output are zero.
- `inclusionai/ling-3.0-flash-fin-free`: `zdr=none`, `no_training=all`; headline input/output are zero.

Therefore `zero_spend_verified=true` MUST NOT imply confidentiality, zero-data-retention, or no-training.

## Hardening implemented

1. Zero-price validation now walks published charge/tier fields, not only headline `input`/`output`, and rejects `varies_by_provider=true`.
2. Zero-spend receipts preserve catalog `owned_by`, `zdr`, `no_training`, and a non-confidential privacy classification.
3. Logical free aliases advertise `confidential_data_supported=false`.
4. A pre-inference high-confidence secret detector blocks private-key blocks and common credential/token shapes before any external model call. Error messages expose only the detector class, never the candidate secret.
5. The same detector covers both the direct peer endpoint and the OpenAI-compatible sovereign facade.
6. CI revalidates all published free-route charges/tier costs and records privacy metadata with zero inference calls.

## Non-claims

- This detector is defense in depth, not a general DLP system and not proof that arbitrary confidential information cannot be present.
- `zdr`/`no_training` catalog metadata is provider/gateway metadata, not an independent security attestation.
- The branch remains an external provider path and therefore tariff/provider dependent even when the currently selected routes cost $0.
- No live federation evidence is produced until governance opens F1 and an authorized isolated deployment plus persisted readback are completed.
