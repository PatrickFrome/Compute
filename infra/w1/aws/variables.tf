variable "region" {
  description = "AWS region for the first persistent W1 host."
  type        = string
}

variable "ami_id" {
  description = "Exact immutable AMI ID. Do not pass a latest/SSM alias at apply time."
  type        = string
  validation {
    condition     = can(regex("^ami-[0-9a-f]+$", var.ami_id))
    error_message = "ami_id must be an exact EC2 AMI ID."
  }
}

variable "instance_type" {
  description = "Persistent host instance type. Firecracker later requires a type exposing /dev/kvm; gVisor does not."
  type        = string
  default     = "t3.large"
}

variable "subnet_id" {
  description = "Existing subnet. Prefer a private subnet with NAT egress."
  type        = string
}

variable "vpc_id" {
  description = "Existing VPC containing subnet_id."
  type        = string
}

variable "associate_public_ip_address" {
  description = "Disabled by default. No inbound security-group rules are created even when enabled."
  type        = bool
  default     = false
}

variable "worker_id" {
  description = "METAENGINE worker ID."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9._:-]{3,160}$", var.worker_id))
    error_message = "worker_id is invalid."
  }
}

variable "gateway_url" {
  description = "HTTPS METAENGINE resource-heartbeat gateway URL."
  type        = string
  validation {
    condition     = startswith(var.gateway_url, "https://")
    error_message = "gateway_url must use HTTPS."
  }
}

variable "worker_bundle_github_sha" {
  description = "Exact 40-hex Compute repository commit containing worker/native-linux. Branch names are forbidden."
  type        = string
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.worker_bundle_github_sha))
    error_message = "worker_bundle_github_sha must be an exact 40-hex commit SHA."
  }
}

variable "bootstrap_secret_arn" {
  description = "Existing AWS Secrets Manager secret containing only the worker bearer token."
  type        = string
  sensitive   = true
  validation {
    condition     = can(regex("^arn:aws[a-z-]*:secretsmanager:", var.bootstrap_secret_arn))
    error_message = "bootstrap_secret_arn must be a Secrets Manager ARN."
  }
}

variable "prepare_gvisor" {
  description = "Install the pinned gVisor PREPARE_ONLY substrate after W1 agent bootstrap. Does not enable A1."
  type        = bool
  default     = true
}

variable "root_volume_size_gib" {
  description = "Encrypted gp3 root volume size."
  type        = number
  default     = 32
  validation {
    condition     = var.root_volume_size_gib >= 16 && var.root_volume_size_gib <= 512
    error_message = "root_volume_size_gib must be 16..512."
  }
}

variable "protect_from_api_termination" {
  description = "Protect persistent host from accidental EC2 API termination. Reboot remains available."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}
