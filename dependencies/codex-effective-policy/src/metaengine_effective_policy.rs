// METAENGINE modification to OpenAI Codex (Apache-2.0), 2026-11-01.
// This guard observes configuration; it grants no native process authority.
use codex_config::LoaderOverrides;
use codex_core::config::Config;
use codex_core::config::ConfigOverrides;
use serde::Deserialize;
use serde_json::json;
use sha2::Digest;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicU8;
use std::sync::atomic::Ordering;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MetaenginePolicyMode {
    Inspect,
    Execute,
}

/// One-shot guard for the local, fresh exec thread. The native host owns stdin/stdout.
#[derive(Clone, Debug)]
pub struct MetaenginePolicyGuard {
    nonce: String,
    mode: MetaenginePolicyMode,
    state: Arc<AtomicU8>,
    expected_prompt_sha256: Option<String>,
    prompt: Arc<Mutex<Option<String>>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Acceptance {
    #[serde(rename = "type")]
    kind: String,
    nonce: String,
    context_id: String,
}

impl MetaenginePolicyGuard {
    pub fn new(nonce: String, mode: MetaenginePolicyMode) -> anyhow::Result<Self> {
        anyhow::ensure!(
            nonce.len() == 64
                && nonce
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
            "effective policy nonce must be 64 lowercase hexadecimal characters"
        );
        Ok(Self {
            nonce,
            mode,
            state: Arc::new(AtomicU8::new(0)),
            expected_prompt_sha256: None,
            prompt: Arc::new(Mutex::new(None)),
        })
    }

    /// Binds the task bytes to the Host's original immutable argv digest.
    pub fn with_prompt_sha256(mut self, digest: String) -> anyhow::Result<Self> {
        anyhow::ensure!(
            digest.len() == 64
                && digest
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
            "effective policy prompt digest must be 64 lowercase hexadecimal characters"
        );
        self.expected_prompt_sha256 = Some(digest);
        Ok(self)
    }

    /// Transfers the exact validated UTF-8 task once; no second stdin read occurs.
    pub fn take_prompt(&self) -> anyhow::Result<String> {
        anyhow::ensure!(
            self.state.load(Ordering::Acquire) == 3,
            "effective policy prompt not admitted"
        );
        self.prompt
            .lock()
            .map_err(|_| anyhow::anyhow!("effective policy prompt state poisoned"))?
            .take()
            .ok_or_else(|| anyhow::anyhow!("effective policy prompt already consumed"))
    }

    pub fn inspection_completed(&self) -> bool {
        self.mode == MetaenginePolicyMode::Inspect && self.state.load(Ordering::Acquire) == 2
    }

    pub(crate) async fn admit(
        &self,
        config: &Config,
        loader: &LoaderOverrides,
        strict_config: bool,
        harness: &ConfigOverrides,
    ) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.state
                .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
                .is_ok(),
            "effective policy guard already used"
        );
        anyhow::ensure!(
            self.mode == MetaenginePolicyMode::Inspect || self.expected_prompt_sha256.is_some(),
            "effective policy execute requires the original prompt digest"
        );
        let policy = crate::metaengine_effective_policy_projection::project(config, loader)?;
        // The UUID is an invocation-local correlation identifier, not a proof or trust root.
        let context_id = uuid::Uuid::now_v7().to_string();
        let mut event = serde_json::to_vec(&json!({
            "type": "metaengine.effective_policy.v1",
            "nonce": self.nonce,
            "context_id": context_id,
            "mode": match self.mode { MetaenginePolicyMode::Inspect => "inspect", MetaenginePolicyMode::Execute => "execute" },
            "strict_config": strict_config,
            "thread_start_overrides": {
                "scope": "TYPED_THREAD_START_OVERRIDES",
                "approval_policy": harness.approval_policy,
                "approvals_reviewer": harness.approvals_reviewer,
                "sandbox_mode": harness.sandbox_mode,
                "permission_profile": harness.permission_profile,
                "default_permissions": harness.default_permissions,
                "persisted_permission_profile_id": harness.persisted_permission_profile_id,
                "cwd": harness.cwd,
                "workspace_roots": harness.workspace_roots,
                "additional_writable_roots": harness.additional_writable_roots,
            },
            "policy": policy,
        }))?;
        anyhow::ensure!(
            event.len() <= 65536,
            "effective policy event exceeds 64 KiB"
        );
        event.push(b'\n');
        let mut output = tokio::io::stdout();
        output.write_all(&event).await?;
        output.flush().await?;
        if self.mode == MetaenginePolicyMode::Inspect {
            self.state.store(2, Ordering::Release);
            anyhow::bail!("effective policy inspection stops before thread creation");
        }
        // Read exactly one bounded frame. Do not buffer or consume any prompt bytes.
        // The existing native controller owns the absolute launch/acceptance deadline.
        let mut input = tokio::io::stdin();
        read_acceptance(&mut input, &self.nonce, &context_id).await?;
        let expected = self
            .expected_prompt_sha256
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("effective policy original prompt digest missing"))?;
        let prompt = read_bound_prompt(&mut input, expected).await?;
        *self
            .prompt
            .lock()
            .map_err(|_| anyhow::anyhow!("effective policy prompt state poisoned"))? = Some(prompt);
        // No thread/prewarm can start until both ACK and original task bytes qualify.
        self.state.store(3, Ordering::Release);
        Ok(())
    }
}

async fn read_acceptance(
    input: &mut (impl tokio::io::AsyncRead + Unpin),
    nonce: &str,
    context_id: &str,
) -> anyhow::Result<()> {
    let mut bytes = Vec::new();
    loop {
        let byte = input.read_u8().await?;
        if byte == b'\n' {
            break;
        }
        anyhow::ensure!(
            bytes.len() < 511,
            "effective policy acceptance exceeds 512 bytes"
        );
        bytes.push(byte);
    }
    validate_acceptance(&bytes, nonce, context_id)
}

async fn read_bound_prompt(
    input: &mut (impl tokio::io::AsyncRead + Unpin),
    expected_sha256: &str,
) -> anyhow::Result<String> {
    // Match the existing native runner's 32,000-byte task budget. Read one extra
    // byte so oversize input refuses without waiting for an unbounded stream.
    let mut bytes = Vec::new();
    input.take(32_001).read_to_end(&mut bytes).await?;
    anyhow::ensure!(
        bytes.len() <= 32_000,
        "effective policy prompt exceeds native task budget"
    );
    anyhow::ensure!(
        format!("{:x}", sha2::Sha256::digest(&bytes)) == expected_sha256,
        "effective policy original prompt digest mismatch"
    );
    let prompt = String::from_utf8(bytes)?;
    anyhow::ensure!(
        !prompt.trim().is_empty(),
        "effective policy prompt is empty"
    );
    Ok(prompt)
}

fn validate_acceptance(bytes: &[u8], nonce: &str, context_id: &str) -> anyhow::Result<()> {
    let acceptance: Acceptance = serde_json::from_slice(bytes)?;
    anyhow::ensure!(
        acceptance.kind == "metaengine.effective_policy.accept.v1"
            && acceptance.nonce == nonce
            && acceptance.context_id == context_id,
        "effective policy acceptance binding mismatch"
    );
    Ok(())
}

#[cfg(test)]
#[path = "metaengine_effective_policy_tests.rs"]
mod tests;
