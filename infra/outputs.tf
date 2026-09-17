output "bucket_name" {
  description = "S3 bucket holding the built site. Not public - only CloudFront can read it."
  value       = aws_s3_bucket.site.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. The deploy workflow needs this to invalidate the cache after every deploy."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "Default *.cloudfront.net URL the site is served from (use this if you didn't configure domain_name)."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  description = "The URL to open the deployed site at."
  value       = local.use_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "github_deploy_role_arn" {
  description = "IAM role ARN the GitHub Actions deploy workflow assumes via OIDC. Set this as the AWS_DEPLOY_ROLE_ARN repository secret."
  value       = aws_iam_role.deploy.arn
}

output "aws_region" {
  description = "Region the S3 bucket lives in. Set this as the AWS_REGION repository secret/variable."
  value       = var.aws_region
}
