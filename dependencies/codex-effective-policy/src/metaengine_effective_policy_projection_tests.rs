use super::*;
use codex_core::config::ConfigBuilder;
use codex_core::config::ConfigOverrides;
use codex_protocol::config_types::SandboxMode;
use codex_protocol::protocol::AskForApproval;
use codex_utils_absolute_path::AbsolutePathBuf;
use pretty_assertions::assert_eq;
use tempfile::TempDir;

struct Fixture {
    root: TempDir,
    home: std::path::PathBuf,
    workspace: std::path::PathBuf,
    loader: LoaderOverrides,
}

impl Fixture {
    fn new() -> anyhow::Result<Self> {
        let root = tempfile::tempdir()?;
        let home = root.path().join("owned-home");
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&home)?;
        std::fs::create_dir(&workspace)?;
        let loader = LoaderOverrides {
            system_config_path: Some(root.path().join("system.toml")),
            managed_config_path: Some(root.path().join("managed.toml")),
            system_requirements_path: Some(root.path().join("requirements.toml")),
            ignore_project_config: true,
            ..LoaderOverrides::without_managed_config_for_tests()
        };
        Ok(Self {
            root,
            home,
            workspace,
            loader,
        })
    }

    async fn config(&self) -> anyhow::Result<Config> {
        Ok(ConfigBuilder::default()
            .codex_home(self.home.clone())
            .loader_overrides(self.loader.clone())
            .harness_overrides(ConfigOverrides {
                cwd: Some(self.workspace.clone()),
                approval_policy: Some(AskForApproval::Never),
                sandbox_mode: Some(SandboxMode::ReadOnly),
                ..Default::default()
            })
            .build()
            .await?)
    }

    fn requirements(&self, contents: &str) -> anyhow::Result<()> {
        std::fs::write(self.root.path().join("requirements.toml"), contents)?;
        Ok(())
    }
}

#[tokio::test]
async fn final_config_projection_keeps_constraints_and_excludes_secret_values() -> anyhow::Result<()>
{
    let fixture = Fixture::new()?;
    std::fs::write(
        fixture.home.join("config.toml"),
        r#"
developer_instructions = "USER_SECRET_SENTINEL"
approval_policy = "on-request"
[mcp_servers.fixture]
command = "NOT_EXECUTED_BY_CONFIG_BUILDER"
env = { TOKEN = "AUTH_SECRET_SENTINEL" }
"#,
    )?;
    fixture.requirements(
        r#"
allowed_approval_policies = ["never"]
allowed_sandbox_modes = ["read-only"]
allow_login_shell = false
additional_developer_instructions = "REQUIREMENT_SECRET_SENTINEL"
[experimental_network]
enabled = false
[[experimental_network.header_injections]]
host = "fixture.invalid"
methods = ["GET"]
path_prefixes = ["/"]
headers = { Authorization = "HEADER_SECRET_SENTINEL" }
"#,
    )?;
    let config = fixture.config().await?;
    let policy = project(&config, &fixture.loader)?;
    let rendered = serde_json::to_string(&policy)?;
    for sentinel in [
        "USER_SECRET_SENTINEL",
        "AUTH_SECRET_SENTINEL",
        "REQUIREMENT_SECRET_SENTINEL",
        "HEADER_SECRET_SENTINEL",
    ] {
        assert!(!rendered.contains(sentinel), "leaked {sentinel}");
    }
    assert_eq!(
        policy["effective"]["permission_profile"],
        json!(config.permissions.effective_permission_profile())
    );
    assert_eq!(
        policy["requirements"]["values"]["allowed_sandbox_modes"],
        json!(["read-only"])
    );
    assert_eq!(
        policy["requirements"]["sources"]["allow_login_shell"]["kind"],
        json!("system_requirements")
    );
    assert_eq!(policy["effective"]["allow_login_shell"], json!(false));
    assert!(policy["origins"].get("allow_login_shell").is_none());
    assert_eq!(policy, project(&config, &fixture.loader)?);
    Ok(())
}

#[tokio::test]
async fn reload_captures_layer_generation_without_dumping_changed_secret() -> anyhow::Result<()> {
    let fixture = Fixture::new()?;
    let file = fixture.home.join("config.toml");
    std::fs::write(&file, "developer_instructions = 'FIRST_SECRET'\n")?;
    let before = project(&fixture.config().await?, &fixture.loader)?;
    std::fs::write(&file, "developer_instructions = 'SECOND_SECRET'\n")?;
    let after = project(&fixture.config().await?, &fixture.loader)?;
    assert_eq!(before["effective"], after["effective"]);
    assert_eq!(before["requirements"], after["requirements"]);
    assert_ne!(before["layers"], after["layers"]);
    assert!(!serde_json::to_string(&after)?.contains("SECOND_SECRET"));
    Ok(())
}

#[tokio::test]
async fn changed_managed_policy_has_a_new_requirement_generation() -> anyhow::Result<()> {
    let fixture = Fixture::new()?;
    fixture.requirements("allow_login_shell = false\n")?;
    let before = project(&fixture.config().await?, &fixture.loader)?;
    fixture.requirements("allow_login_shell = true\n")?;
    let after = project(&fixture.config().await?, &fixture.loader)?;
    assert_ne!(
        before["requirements"]["generation"],
        after["requirements"]["generation"]
    );
    assert_eq!(after["effective"]["allow_login_shell"], json!(true));
    Ok(())
}

#[tokio::test]
async fn ignore_user_mode_uses_the_same_loader_flags_as_the_config() -> anyhow::Result<()> {
    let mut fixture = Fixture::new()?;
    std::fs::write(
        fixture.home.join("config.toml"),
        "allow_login_shell = false\n",
    )?;
    let loaded = project(&fixture.config().await?, &fixture.loader)?;
    fixture.loader.ignore_user_config = true;
    let ignored = project(&fixture.config().await?, &fixture.loader)?;
    assert_eq!(loaded["effective"]["allow_login_shell"], json!(false));
    assert_eq!(ignored["effective"]["allow_login_shell"], json!(true));
    assert_eq!(ignored["load_mode"]["ignore_user_config"], json!(true));
    let users = ignored["layers"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|layer| layer["name"] == "user")
        .collect::<Vec<_>>();
    assert!(!users.is_empty());
    assert!(users.iter().all(|layer| layer["loader_ignored"] == true
        && layer["content_scope"] == "IGNORED_EMPTY_PLACEHOLDER"));
    // Ignored user metadata fingerprints an empty placeholder, not file bytes.
    std::fs::write(
        fixture.home.join("config.toml"),
        "INVALID TOML [ USER_SECRET",
    )?;
    assert_eq!(ignored, project(&fixture.config().await?, &fixture.loader)?);
    Ok(())
}

#[tokio::test]
async fn disabled_metadata_omits_reason_and_excess_layers_are_rejected() -> anyhow::Result<()> {
    let fixture = Fixture::new()?;
    let mut config = fixture.config().await?;
    let layer = codex_config::ConfigLayerEntry::new_disabled(
        ConfigLayerSource::SessionFlags,
        toml::Value::Table(Default::default()),
        "DISABLED_REASON_SECRET",
    );
    let requirements = config.config_layer_stack.requirements().clone();
    let raw = config.config_layer_stack.requirements_toml().clone();
    config.config_layer_stack = codex_config::ConfigLayerStack::new(
        vec![layer.clone()],
        requirements.clone(),
        raw.clone(),
    )?;
    let output = project(&config, &fixture.loader)?;
    assert_eq!(output["layers"][0]["enabled"], json!(false));
    assert!(!serde_json::to_string(&output)?.contains("DISABLED_REASON_SECRET"));
    config.config_layer_stack =
        codex_config::ConfigLayerStack::new(vec![layer; MAX_LAYERS + 1], requirements, raw)?;
    assert_eq!(
        project(&config, &fixture.loader).unwrap_err().to_string(),
        "effective_policy_layer_limit"
    );
    Ok(())
}

#[tokio::test]
async fn origin_and_total_size_limits_fail_closed() -> anyhow::Result<()> {
    let fixture = Fixture::new()?;
    let roots = (0..=MAX_ORIGINS)
        .map(|index| {
            toml::Value::String(
                fixture
                    .workspace
                    .join(format!("root-{index}"))
                    .to_string_lossy()
                    .into_owned(),
            )
        })
        .collect();
    let config = ConfigBuilder::default()
        .codex_home(fixture.home.clone())
        .loader_overrides(fixture.loader.clone())
        .harness_overrides(ConfigOverrides {
            cwd: Some(fixture.workspace.clone()),
            ..Default::default()
        })
        .cli_overrides(vec![(
            "sandbox_workspace_write.writable_roots".to_string(),
            toml::Value::Array(roots),
        )])
        .build()
        .await?;
    assert_eq!(
        project(&config, &fixture.loader).unwrap_err().to_string(),
        "effective_policy_origin_limit"
    );
    let mut config = fixture.config().await?;
    let root = AbsolutePathBuf::from_absolute_path(fixture.workspace.clone())?;
    config.workspace_roots = vec![root; MAX_BYTES];
    assert_eq!(
        project(&config, &fixture.loader).unwrap_err().to_string(),
        "effective_policy_byte_limit"
    );
    Ok(())
}

#[tokio::test]
async fn model_conditional_policy_is_refused_before_emission() -> anyhow::Result<()> {
    let fixture = Fixture::new()?;
    fixture.requirements("[auto_review]\nrequired_on_models = ['gpt-test']\n")?;
    let config = fixture.config().await?;
    assert_eq!(
        project(&config, &fixture.loader).unwrap_err().to_string(),
        "effective_policy_model_conditional_policy_unsupported"
    );
    Ok(())
}
