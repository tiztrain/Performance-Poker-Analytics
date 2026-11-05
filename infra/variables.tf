variable "project_name" {
  description = "Short name used to prefix all resource names."
  type        = string
  default     = "poker-hand-review"
}

variable "aws_region" {
  description = "AWS region for the S3 bucket. CloudFront itself is global."
  type        = string
  default     = "ap-southeast-2"
}

variable "github_owner" {
  description = "Your GitHub username or org, e.g. \"tiz\"."
  type        = string
}

variable "github_repo" {
  description = "Repository name, e.g. \"poker-hand-review\"."
  type        = string
}

variable "github_owner_id" {
  description = "Numeric GitHub owner ID, from https://api.github.com/users/<owner> (field \"id\")."
  type        = string
}

variable "github_repo_id" {
  description = "Numeric GitHub repository ID, from https://api.github.com/repos/<owner>/<repo> (field \"id\")."
  type        = string
}

variable "github_branch" {
  description = "Branch allowed to assume the deploy role (deploys run on merge to this branch)."
  type        = string
  default     = "main"
}

variable "create_oidc_provider" {
  description = <<-EOT
    Whether to create the GitHub Actions OIDC provider in this AWS account.
    An AWS account can only have ONE OIDC provider per URL - if a previous
    project already created https://token.actions.githubusercontent.com,
    set this to false and set existing_oidc_provider_arn instead, or this
    apply will fail with "EntityAlreadyExists".
  EOT
  type        = bool
  default     = true
}

variable "existing_oidc_provider_arn" {
  description = "ARN of an already-existing GitHub OIDC provider, used only when create_oidc_provider = false."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Optional custom domain (e.g. \"poker.yourdomain.com\"). Leave blank to use the default *.cloudfront.net URL - the whole setup works fine without one."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Hosted zone ID to create the domain's DNS record in. Required only if domain_name is set and you want Terraform to manage DNS too."
  type        = string
  default     = ""
}
