use crate::LinuxSkillSource;
use landlock::{
    ABI, Access, AccessFs, AccessNet, CompatLevel, Compatible, PathBeneath, RestrictionStatus,
    Ruleset, RulesetAttr, RulesetCreatedAttr, RulesetStatus,
};
use std::fmt;

const REQUIRED_ABI: ABI = ABI::V4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxError {
    code: &'static str,
}

impl SandboxError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for SandboxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code)
    }
}

impl std::error::Error for SandboxError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxReport {
    pub fully_enforced: bool,
    pub no_new_privs: bool,
    pub filesystem_read_only: bool,
    pub tcp_bind_connect_denied: bool,
    pub udp_isolation_claimed: bool,
}

fn map_ruleset_error<T>(result: Result<T, landlock::RulesetError>) -> Result<T, SandboxError> {
    result.map_err(|_| SandboxError::new("skill_helper_sandbox_ruleset_failed"))
}

fn require_full_enforcement(status: RestrictionStatus) -> Result<SandboxReport, SandboxError> {
    if status.ruleset != RulesetStatus::FullyEnforced || !status.no_new_privs {
        return Err(SandboxError::new("skill_helper_sandbox_not_fully_enforced"));
    }
    Ok(SandboxReport {
        fully_enforced: true,
        no_new_privs: true,
        filesystem_read_only: true,
        tcp_bind_connect_denied: true,
        // landlock 0.4.7 understands through ABI 9. Kernel ABI 10 adds UDP rights, but this
        // dependency does not expose them yet, so R7H intentionally makes no UDP-isolation claim.
        udp_isolation_claimed: false,
    })
}

impl LinuxSkillSource {
    /// Irreversibly restrict the current helper process after the configured skill root has been
    /// opened. R7H hard-requires Landlock ABI 4 so filesystem access is read-only beneath the
    /// exact existing root descriptor and TCP bind/connect are denied globally.
    pub fn restrict_helper_process(&self) -> Result<SandboxReport, SandboxError> {
        let filesystem_all = AccessFs::from_all(REQUIRED_ABI);
        let filesystem_read = AccessFs::from_read(REQUIRED_ABI);
        let tcp_all = AccessNet::from_all(REQUIRED_ABI);

        let ruleset = map_ruleset_error(
            Ruleset::default()
                .set_compatibility(CompatLevel::HardRequirement)
                .handle_access(filesystem_all),
        )?;
        let ruleset = map_ruleset_error(ruleset.handle_access(tcp_all))?;
        let created =
            map_ruleset_error(ruleset.create())?.set_compatibility(CompatLevel::HardRequirement);
        let root_rule = PathBeneath::new(&self.root, filesystem_read)
            .set_compatibility(CompatLevel::HardRequirement);
        let created = map_ruleset_error(created.add_rule(root_rule))?;
        let status = map_ruleset_error(created.restrict_self())?;
        require_full_enforcement(status)
    }
}
