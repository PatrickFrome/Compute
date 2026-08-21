terraform {
  required_version = "= 1.15.8"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.60.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "w1" {
  name_prefix        = "metaengine-h205f22-w1-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "bootstrap_secret" {
  statement {
    sid       = "ReadOnlyExactWorkerBootstrapSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.bootstrap_secret_arn]
  }
}

resource "aws_iam_role_policy" "bootstrap_secret" {
  name_prefix = "w1-bootstrap-secret-"
  role        = aws_iam_role.w1.id
  policy      = data.aws_iam_policy_document.bootstrap_secret.json
}

resource "aws_iam_instance_profile" "w1" {
  name_prefix = "metaengine-h205f22-w1-"
  role        = aws_iam_role.w1.name
  tags        = local.tags
}

resource "aws_security_group" "w1" {
  name_prefix = "metaengine-h205f22-w1-"
  description = "Outbound-only W1 host; no SSH or other ingress"
  vpc_id      = var.vpc_id

  # Cloud-init GitHub fetch, Secrets Manager, resource gateway, OS TLS traffic.
  egress {
    description = "HTTPS egress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Resolver traffic. The hardened worker service independently pins its own
  # DNS and gateway egress using systemd IPAddressAllow/IPAddressDeny.
  egress {
    description = "DNS UDP"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "DNS TCP fallback"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "NTP"
    from_port   = 123
    to_port     = 123
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

locals {
  tags = merge(var.tags, {
    "metaengine:project"        = "H205F22"
    "metaengine:milestone"      = "W1_PERSISTENT_LINUX_WORKER_SAFETY"
    "metaengine:worker_id"      = var.worker_id
    "metaengine:github_sha"     = var.worker_bundle_github_sha
    "metaengine:authority"      = "noncanonical-worker"
    "metaengine:execution_tier" = "persistent-host"
  })

  user_data = templatefile("${path.module}/cloud-init.sh.tftpl", {
    region               = var.region
    bootstrap_secret_arn = var.bootstrap_secret_arn
    github_sha           = var.worker_bundle_github_sha
    worker_id            = var.worker_id
    gateway_url          = var.gateway_url
    prepare_gvisor       = tostring(var.prepare_gvisor)
  })
}

resource "aws_instance" "w1" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  associate_public_ip_address = var.associate_public_ip_address
  vpc_security_group_ids      = [aws_security_group.w1.id]
  iam_instance_profile        = aws_iam_instance_profile.w1.name

  # Persistent host guardrails. The provider/controller may still issue RebootInstances,
  # which is required for W1 proof and is recorded by AWS/CloudTrail.
  disable_api_termination = var.protect_from_api_termination
  disable_api_stop        = var.protect_from_api_termination

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_protocol_ipv6          = "disabled"
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    encrypted             = true
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gib
    delete_on_termination = true
  }

  user_data                   = local.user_data
  user_data_replace_on_change = false
  monitoring                  = true

  tags = merge(local.tags, { Name = "metaengine-h205f22-${var.worker_id}" })

  lifecycle {
    precondition {
      condition     = var.worker_bundle_github_sha != "0000000000000000000000000000000000000000"
      error_message = "worker_bundle_github_sha must identify real reviewed code."
    }
  }
}
