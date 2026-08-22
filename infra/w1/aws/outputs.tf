output "instance_id" {
  description = "EC2 instance ID used by the independent provider reboot controller."
  value       = aws_instance.w1.id
}

output "instance_arn" {
  description = "EC2 instance ARN."
  value       = aws_instance.w1.arn
}

output "private_ip" {
  description = "Private IPv4 address."
  value       = aws_instance.w1.private_ip
}

output "public_ip" {
  description = "Public IPv4 address when explicitly enabled. No ingress rules are created."
  value       = aws_instance.w1.public_ip
}

output "worker_id" {
  value = var.worker_id
}

output "worker_bundle_github_sha" {
  value = var.worker_bundle_github_sha
}

output "next_required_action" {
  value = "WAIT_FOR_ACCEPTED_HEARTBEAT_WINDOW_THEN_PROVIDER_API_REBOOT"
}
