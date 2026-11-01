use super::*;

#[test]
fn acceptance_rejects_replay_unknown_fields_and_forged_readiness() {
    let good = br#"{"type":"metaengine.effective_policy.accept.v1","nonce":"nonce","context_id":"context"}"#;
    assert!(validate_acceptance(good, "nonce", "context").is_ok());
    assert!(validate_acceptance(good, "other", "context").is_err());
    assert!(validate_acceptance(good, "nonce", "previous-context").is_err());
    assert!(validate_acceptance(br#"{"type":"metaengine.effective_policy.accept.v1","nonce":"nonce","context_id":"context","verified":true}"#, "nonce", "context").is_err());
    assert!(validate_acceptance(br#"{"verified":true}"#, "nonce", "context").is_err());
}

#[test]
fn nonce_is_bounded_and_cannot_be_control_data() {
    assert!(MetaenginePolicyGuard::new("a".repeat(64), MetaenginePolicyMode::Inspect).is_ok());
    for nonce in [
        "a".repeat(63),
        "A".repeat(64),
        "\n".repeat(64),
        "z".repeat(64),
    ] {
        assert!(MetaenginePolicyGuard::new(nonce, MetaenginePolicyMode::Execute).is_err());
    }
}

#[tokio::test]
async fn accepted_frame_preserves_every_prompt_byte() -> anyhow::Result<()> {
    let frame = b"{\"type\":\"metaengine.effective_policy.accept.v1\",\"nonce\":\"nonce\",\"context_id\":\"context\"}\nExact prompt\nwith another line\n";
    let mut input = frame.as_slice();
    read_acceptance(&mut input, "nonce", "context").await?;
    assert_eq!(input, b"Exact prompt\nwith another line\n");
    Ok(())
}

#[tokio::test]
async fn unterminated_and_oversized_acceptances_are_refused() {
    let mut unterminated = b"{\"verified\":true}".as_slice();
    assert!(
        read_acceptance(&mut unterminated, "nonce", "context")
            .await
            .is_err()
    );
    let oversized = vec![b' '; 513];
    let mut input = oversized.as_slice();
    assert!(
        read_acceptance(&mut input, "nonce", "context")
            .await
            .is_err()
    );
    assert_eq!(input.len(), 1);
    let duplicate = br#"{"type":"metaengine.effective_policy.accept.v1","nonce":"nonce","nonce":"nonce","context_id":"context"}"#;
    assert!(validate_acceptance(duplicate, "nonce", "context").is_err());
}

#[tokio::test]
async fn bound_prompt_preserves_original_utf8_bytes_and_rejects_second_ack() -> anyhow::Result<()> {
    let original = "Exact task\r\nПривет λ\n".as_bytes();
    let digest = format!("{:x}", sha2::Sha256::digest(original));
    let mut input = original;
    let prompt = read_bound_prompt(&mut input, &digest).await?;
    assert_eq!(prompt.as_bytes(), original);
    let mut contaminated = b"{\"type\":\"metaengine.effective_policy.accept.v1\",\"nonce\":\"nonce\",\"context_id\":\"context\"}\n".to_vec();
    contaminated.extend_from_slice(original);
    assert!(
        read_bound_prompt(&mut contaminated.as_slice(), &digest)
            .await
            .is_err()
    );
    let mut altered = original.to_vec();
    altered.push(b'\n');
    assert!(
        read_bound_prompt(&mut altered.as_slice(), &digest)
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn prompt_budget_encoding_and_empty_task_fail_closed() {
    for bytes in [Vec::new(), b" \n".to_vec(), vec![0xff], vec![b'x'; 32_001]] {
        let digest = format!("{:x}", sha2::Sha256::digest(&bytes));
        assert!(
            read_bound_prompt(&mut bytes.as_slice(), &digest)
                .await
                .is_err()
        );
    }
}

#[test]
fn original_prompt_digest_and_one_time_transfer_are_required() -> anyhow::Result<()> {
    let guard = MetaenginePolicyGuard::new("a".repeat(64), MetaenginePolicyMode::Execute)?;
    assert!(guard.take_prompt().is_err());
    assert!(guard.clone().with_prompt_sha256("B".repeat(64)).is_err());
    let guard = guard.with_prompt_sha256("b".repeat(64))?;
    *guard
        .prompt
        .lock()
        .map_err(|_| anyhow::anyhow!("test prompt lock poisoned"))? =
        Some("original task".to_string());
    guard.state.store(3, Ordering::Release);
    assert_eq!(guard.take_prompt()?, "original task");
    assert!(guard.take_prompt().is_err());
    Ok(())
}
