// METAENGINE modification: bounded policy projection for the pinned Codex source.
// This describes resolved configuration, not native sandbox/process qualification.
use anyhow::ensure;
use codex_config::ConfigLayerSource;
use codex_config::LoaderOverrides;
use codex_config::RequirementSource;
use codex_core::config::Config;
use serde_json::Value;
use serde_json::json;
use sha2::Digest;
use std::collections::BTreeMap;

const MAX_LAYERS: usize = 128;
const MAX_ORIGINS: usize = 1024;
const MAX_BYTES: usize = 64 * 1024;

pub(crate) fn project(config: &Config, loader: &LoaderOverrides) -> anyhow::Result<Value> {
    let stack = &config.config_layer_stack;
    // Core can change approval reviewer/profile after selecting a model. V1
    // refuses those conditional requirements before issuing a stale projection.
    ensure!(
        stack.requirements().auto_review_required_models.is_none(),
        "effective_policy_model_conditional_policy_unsupported"
    );
    ensure!(
        stack.all_layers_high_to_low().count() <= MAX_LAYERS,
        "effective_policy_layer_limit"
    );
    let layers = stack
        .all_layers_high_to_low()
        .map(|layer| {
            let loader_ignored = matches!(layer.name, ConfigLayerSource::User { .. }) && loader.ignore_user_config;
            ensure!(!loader_ignored || layer.config.as_table().is_some_and(toml::map::Map::is_empty), "effective_policy_ignored_layer_not_empty");
            Ok(json!({"name": layer_kind(&layer.name), "source": layer_source(&layer.name),
                "version": layer.version, "enabled": !layer.is_disabled(), "loader_ignored": loader_ignored,
                "content_scope": if loader_ignored { "IGNORED_EMPTY_PLACEHOLDER" } else { "RESOLVED_LAYER_CONTENT" }}))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let origins = stack.origins_with_path_filter(|segments| {
        policy_path(segments)
            && stack
                .requirements_toml()
                .exact_requirement_for_config_path(segments)
                .is_none()
    });
    ensure!(
        origins.len() <= MAX_ORIGINS,
        "effective_policy_origin_limit"
    );
    let origins = origins
        .into_iter()
        .map(|(path, layer)| {
            (
                path,
                json!({"name": layer_kind(&layer.name), "source": layer_source(&layer.name),
            "version": layer.version}),
            )
        })
        .collect::<BTreeMap<_, _>>();

    // Each field is selected explicitly. In particular, proxy header injections,
    // provider/auth settings, hook bodies and instructions never enter this map.
    let raw = stack.requirements_toml();
    let requirements = stack.requirements();
    let mut values = BTreeMap::from([
        (
            "allowed_approval_policies",
            json!(raw.allowed_approval_policies),
        ),
        (
            "allowed_approvals_reviewers",
            json!(raw.allowed_approvals_reviewers),
        ),
        ("allowed_sandbox_modes", json!(raw.allowed_sandbox_modes)),
        (
            "allowed_permission_profiles",
            json!(raw.allowed_permission_profiles),
        ),
        ("default_permissions", json!(raw.default_permissions)),
        ("allow_login_shell", json!(raw.allow_login_shell)),
    ]);
    let windows = raw
        .windows
        .as_ref()
        .and_then(|windows| windows.allowed_sandbox_implementations.as_ref());
    values.insert(
        "windows.allowed_sandbox_implementations",
        match windows {
            None => Value::Null,
            Some(modes) => json!(
                modes
                    .iter()
                    .map(|mode| match mode {
                        codex_config::WindowsSandboxImplementationToml::Elevated => "elevated",
                        codex_config::WindowsSandboxImplementationToml::Unelevated => "unelevated",
                    })
                    .collect::<Vec<_>>()
            ),
        },
    );
    values.insert(
        "permission_profile",
        if requirements.permission_profile.source.is_some() {
            json!(requirements.permission_profile.get())
        } else {
            Value::Null
        },
    );
    values.insert(
        "permissions.filesystem",
        json!(
            requirements
                .filesystem
                .as_ref()
                .map(|filesystem| &filesystem.value)
        ),
    );
    values.insert("experimental_network", raw.network.as_ref().map_or(Value::Null, |network| {
        json!({"enabled": network.enabled, "http_port": network.http_port,
            "socks_port": network.socks_port, "allow_upstream_proxy": network.allow_upstream_proxy,
            "dangerously_allow_non_loopback_proxy": network.dangerously_allow_non_loopback_proxy,
            "dangerously_allow_all_unix_sockets": network.dangerously_allow_all_unix_sockets,
            "domains": network.domains, "managed_allowed_domains_only": network.managed_allowed_domains_only,
            "unix_sockets": network.unix_sockets, "allow_local_binding": network.allow_local_binding})
    }));
    let sources = BTreeMap::from([
        (
            "allowed_approval_policies",
            requirement_source(requirements.approval_policy.source.as_ref()),
        ),
        (
            "allowed_approvals_reviewers",
            requirement_source(requirements.approvals_reviewer.source.as_ref()),
        ),
        (
            "allowed_sandbox_modes",
            requirement_source(requirements.permission_profile.source.as_ref()),
        ),
        (
            "allowed_permission_profiles",
            requirement_source(requirements.permission_profile.source.as_ref()),
        ),
        (
            "default_permissions",
            requirement_source(requirements.permission_profile.source.as_ref()),
        ),
        (
            "permission_profile",
            requirement_source(requirements.permission_profile.source.as_ref()),
        ),
        (
            "allow_login_shell",
            requirement_source(
                requirements
                    .allow_login_shell
                    .as_ref()
                    .map(|field| &field.source),
            ),
        ),
        (
            "windows.allowed_sandbox_implementations",
            requirement_source(requirements.windows_sandbox_mode.source.as_ref()),
        ),
        (
            "permissions.filesystem",
            requirement_source(requirements.filesystem.as_ref().map(|field| &field.source)),
        ),
        (
            "experimental_network",
            requirement_source(requirements.network.as_ref().map(|field| &field.source)),
        ),
    ]);
    let requirement_values = json!({"values": values, "sources": sources});
    let output = canonical(json!({
        "schema": "metaengine.codex.effective-policy.v1",
        "upstream_commit": "3b01b36fa5eb96ba82a776bd3c2fc57f8969181f",
        "stage": "THREAD_START_RESOLVED_BEFORE_SPAWN",
        "cwd": config.cwd,
        "load_mode": {
            "ignore_user_config": loader.ignore_user_config,
            "ignore_project_config": loader.ignore_project_config,
            "ignore_managed_requirements": loader.ignore_managed_requirements,
            "ignore_login_requirements": loader.ignore_login_requirements,
            "ignore_user_and_project_exec_policy_rules": loader.ignore_user_and_project_exec_policy_rules,
            "user_config_profile": loader.user_config_profile.as_ref().map(|_| "selected"),
            "user_config_path_override": loader.user_config_path.is_some(),
        },
        "effective": {
            "permission_profile": config.permissions.effective_permission_profile(),
            "active_permission_profile": config.permissions.active_permission_profile(),
            "explicit_permission_profile_mode": config.explicit_permission_profile_mode,
            "approval_policy": config.permissions.approval_policy.value(),
            "approvals_reviewer": config.approvals_reviewer,
            "allow_login_shell": config.permissions.allow_login_shell,
            "workspace_roots": config.workspace_roots,
            "permission_workspace_roots": config.permissions.workspace_roots(),
            "profile_workspace_roots": config.permissions.profile_workspace_roots().iter()
                .map(|root| root.as_uri().to_string()).collect::<Vec<_>>(),
            "windows": {"configured_mode": config.permissions.windows_sandbox_mode,
                "configured_backend": config.windows_sandbox_type_from_config(),
                "effective_local_backend": config.effective_local_windows_sandbox_type()},
        },
        "requirements": {"values": requirement_values["values"],
            "sources": requirement_values["sources"], "source_scope": "NORMALIZED_CONSTRAINT",
            "generation": fingerprint(&requirement_values)},
        "layers": layers,
        "origins": origins,
        "origins_scope": "CONFIG_LAYER_MERGE_EXCLUDING_REQUIREMENTS_AND_HARNESS_OVERRIDES",
    }));
    ensure!(
        serde_json::to_vec(&output)?.len() <= MAX_BYTES,
        "effective_policy_byte_limit"
    );
    Ok(output)
}

fn policy_path(segments: &[String]) -> bool {
    let Some(first) = segments.first().map(String::as_str) else {
        return false;
    };
    match first {
        "approval_policy"
        | "approvals_reviewer"
        | "sandbox_mode"
        | "default_permissions"
        | "allow_login_shell" => segments.len() == 1,
        "windows" => segments.get(1).is_some_and(|key| key == "sandbox"),
        "sandbox_workspace_write" => segments.get(1).is_some_and(|key| {
            matches!(
                key.as_str(),
                "writable_roots"
                    | "network_access"
                    | "exclude_tmpdir_env_var"
                    | "exclude_slash_tmp"
            )
        }),
        "permissions" => {
            segments.get(2).is_some_and(|key| {
                matches!(key.as_str(), "extends" | "workspace_roots" | "filesystem")
            }) || segments.get(2).is_some_and(|key| key == "network")
                && segments.get(3).is_some_and(|key| {
                    matches!(
                        key.as_str(),
                        "enabled"
                            | "domains"
                            | "unix_sockets"
                            | "allow_local_binding"
                            | "allow_upstream_proxy"
                            | "dangerously_allow_non_loopback_proxy"
                            | "dangerously_allow_all_unix_sockets"
                    )
                })
        }
        _ => false,
    }
}

fn layer_kind(source: &ConfigLayerSource) -> &'static str {
    match source {
        ConfigLayerSource::PackagedDefaults { .. } => "packaged_defaults",
        ConfigLayerSource::Mdm { .. } => "mdm",
        ConfigLayerSource::System { .. } => "system",
        ConfigLayerSource::EnterpriseManaged { .. } => "enterprise_managed",
        ConfigLayerSource::User { .. } => "user",
        ConfigLayerSource::Project { .. } => "project",
        ConfigLayerSource::SessionFlags => "session_flags",
        ConfigLayerSource::LegacyManagedConfigTomlFromFile { .. } => "legacy_managed_file",
        ConfigLayerSource::LegacyManagedConfigTomlFromMdm => "legacy_managed_mdm",
    }
}

fn layer_source(source: &ConfigLayerSource) -> Value {
    let identity = match source {
        ConfigLayerSource::PackagedDefaults { file }
        | ConfigLayerSource::System { file }
        | ConfigLayerSource::LegacyManagedConfigTomlFromFile { file } => json!(file),
        ConfigLayerSource::Mdm { domain, key } => json!([domain, key]),
        ConfigLayerSource::EnterpriseManaged { id, name } => json!([id, name]),
        ConfigLayerSource::User { file, profile } => json!([file, profile]),
        ConfigLayerSource::Project { dot_codex_folder } => json!(dot_codex_folder),
        ConfigLayerSource::SessionFlags | ConfigLayerSource::LegacyManagedConfigTomlFromMdm => {
            Value::Null
        }
    };
    json!({"kind": layer_kind(source), "identity_generation": fingerprint(&identity)})
}

fn requirement_source(source: Option<&RequirementSource>) -> Value {
    match source {
        None => Value::Null,
        Some(RequirementSource::Unknown) => json!({"kind": "unknown"}),
        Some(RequirementSource::Composite { sources }) => json!({"kind": "composite",
            "sources": sources.iter().map(|source| requirement_source(Some(source))).collect::<Vec<_>>() }),
        Some(RequirementSource::MdmManagedPreferences { domain, key }) => {
            json!({"kind": "mdm", "identity_generation": fingerprint(&json!([domain, key]))})
        }
        Some(RequirementSource::EnterpriseManaged { id, name }) => {
            json!({"kind": "enterprise_managed", "identity_generation": fingerprint(&json!([id, name]))})
        }
        Some(RequirementSource::SystemRequirementsToml { file }) => {
            json!({"kind": "system_requirements", "identity_generation": fingerprint(&json!(file))})
        }
        Some(RequirementSource::LegacyManagedConfigTomlFromFile { file }) => {
            json!({"kind": "legacy_managed_file", "identity_generation": fingerprint(&json!(file))})
        }
        Some(RequirementSource::LegacyManagedConfigTomlFromMdm) => {
            json!({"kind": "legacy_managed_mdm"})
        }
    }
}

fn fingerprint(value: &Value) -> String {
    let serialized = canonical(value.clone()).to_string();
    format!("sha256:{:x}", sha2::Sha256::digest(serialized.as_bytes()))
}

fn canonical(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| (key, canonical(value)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(canonical).collect()),
        other => other,
    }
}

#[cfg(test)]
#[path = "metaengine_effective_policy_projection_tests.rs"]
mod tests;
