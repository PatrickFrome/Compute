from pathlib import Path

SQL = Path('supabase/migrations/20260902125000_devos_expired_result_successor_adoption_v1.sql').read_text()

required = [
    "for update",
    "state not in ('RESULT_READY','AMBIGUOUS')",
    "LEASE_EXPIRED_RESULT_UNADOPTED",
    "lease_expires_at > clock_timestamp()",
    "result_sha256 is distinct from p_expected_result_sha256",
    "VERIFY_AND_ADOPT_EXISTING_RESULT_WITHOUT_REPLAY",
    "'automatic_retry_allowed',false",
    "'browser_authority',false",
    "'promotion_authority',false",
    "'source_completed',false",
    "'source_released',false",
    "'result_replayed',false",
    "'authority_effect',false",
    "on conflict (idempotency_key)",
    "revoke all on function",
]

for token in required:
    assert token in SQL, f'missing fail-closed successor-adoption contract: {token}'

for forbidden in [
    "state='COMPLETED'",
    "state = 'COMPLETED'",
    "state='RELEASED'",
    "state = 'RELEASED'",
    "automatic_retry_allowed',true",
    "authority_effect',true",
]:
    assert forbidden not in SQL, f'forbidden expired-lease bypass present: {forbidden}'

print('devos expired result successor adoption contract: PASS')
