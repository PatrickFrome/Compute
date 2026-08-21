# W1 AWS reference persistent host

This module is the first reference provider path for `W1_PERSISTENT_LINUX_WORKER_SAFETY`.
It does **not** make AWS a roadmap requirement: the worker bootstrap and the Supabase
persistence verifier remain provider-neutral.

## Security boundary

- No ingress rules are created. There is no SSH control path.
- The AMI is an exact caller-supplied `ami-*`; the module never resolves `latest`.
- Worker code is downloaded from an exact 40-hex `PatrickFrome/Compute` commit.
- Terraform is pinned to `1.15.8`; AWS provider is pinned to `6.60.0`.
- EC2 IMDSv2 is required and the metadata hop limit is `1`.
- The worker bearer token is not in Terraform user-data. User-data contains only the
  ARN of an existing Secrets Manager secret; the EC2 role may call only
  `secretsmanager:GetSecretValue` on that exact ARN.
- Root storage is encrypted gp3.
- Stop/termination protection is enabled by default.
- The worker service itself keeps its independent systemd network allowlist and H1-H13
  safety envelope.
- `prepare_gvisor=true` installs the pinned gVisor substrate in `PREPARE_ONLY`; no OCI
  runtime registration or user workload occurs before W1 verification.

## Required existing AWS objects

The module intentionally does not create a VPC or the bootstrap secret. Supply:

1. a VPC and subnet with outbound HTTPS/DNS/NTP reachability (prefer a private subnet + NAT),
2. an exact Ubuntu/Debian-compatible AMI ID,
3. a Secrets Manager secret whose **entire SecretString** is the W1 bearer token,
4. AWS credentials outside this repository with permission to create this EC2/IAM/SG surface.

Do not put the bearer token in `.tfvars`, GitHub Actions variables, instance user-data,
or Terraform state.

## Example

```hcl
module "w1" {
  source = "./infra/w1/aws"

  region                   = "us-east-2"
  vpc_id                   = "vpc-..."
  subnet_id                = "subnet-..."
  ami_id                   = "ami-..."
  worker_id                = "w1-aws-001"
  gateway_url              = "https://..."
  worker_bundle_github_sha = "0123456789abcdef0123456789abcdef01234567"
  bootstrap_secret_arn     = "arn:aws:secretsmanager:us-east-2:...:secret:..."

  # false is safer. Set true only for a public subnet when no NAT is available.
  associate_public_ip_address = false
}
```

## Authoritative W1 proof sequence

Creating the EC2 instance is **not** W1 proof.

1. Apply the module and wait for `metaengine-worker.service` to become active.
2. Supabase must observe the accepted heartbeat window from one stable
   machine/witness identity.
3. The controller, not the host, calls the EC2 `RebootInstances` API.
4. Capture the provider request/action evidence and CloudTrail reboot record.
5. After the instance returns, Supabase must observe the same machine ID and witness ID
   with a different boot ID.
6. Record the provider reboot receipt in the independent reboot-receipt plane.
7. Re-run H1-H13 against the persistent host.
8. Independent Analyst checks exact Git SHA, CI, host/reboot evidence, provider evidence,
   and all nonclaims.
9. Only the Mainline Supervisor may seal a checkpoint and mark W1 `VERIFIED`.

Until all steps pass:

```text
persistent_worker_proof=false
w1_verified=false
a1_runtime_authority=false
```

## Why AWS is the first reference provider

AWS exposes a signed EC2 Instance Identity Document and records API-driven instance
reboots in CloudTrail. Those signals provide an independent provider/controller plane
in addition to the worker's own heartbeat witness. DigitalOcean and Hetzner can use the
same provider-neutral receipt schema later with their API action receipts.
