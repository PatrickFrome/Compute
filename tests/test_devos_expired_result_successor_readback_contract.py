from pathlib import Path

SQL = Path('supabase/migrations/20260902165500_devos_expired_result_successor_readback_v1.sql').read_text()

required = [
    "devos_verify_expired_result_successor_readback_v1",
    "source_lease_not_expired",
    "LEASE_EXPIRED_RESULT_UNADOPTED",
    "DEVOS_EXPIRED_RESULT_SUCCESSOR_ADOPTION_V1",
    "VERIFY_AND_ADOPT_EXISTING_RESULT_WITHOUT_REPLAY",
    "source_lease_agent_id",
    "source_lease_tab_id",
    "source_lease_target_id",
    "source_agent_generation_epoch",
    "source_lease_generation",
    "'source_completed',false",
    "'source_released',false",
    "'result_replayed',false",
    "'automatic_retry_allowed',false",
    "'browser_authority',false",
    "'promotion_authority',false",
    "'authority_effect',false",
    "revoke all on function",
]

for token in required:
    assert token in SQL, f'missing successor-readback fence: {token}'

for forbidden in [
    "insert into destruktion_meta.devos_fleet_task_h205f22",
    "update destruktion_meta.devos_fleet_task_h205f22",
    "delete from destruktion_meta.devos_fleet_task_h205f22",
    "state='COMPLETED'",
    "state = 'COMPLETED'",
    "automatic_retry_allowed',true",
    "browser_authority',true",
    "promotion_authority',true",
    "authority_effect',true",
]:
    assert forbidden not in SQL.lower() if forbidden == forbidden.lower() else forbidden not in SQL, f'forbidden authority/mutation present: {forbidden}'

print('devos expired result successor readback contract: PASS')
