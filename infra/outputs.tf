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

output "cognito_domain" {
  description = "Host of the Cognito hosted login pages. Set this as the COGNITO_DOMAIN repository variable (and VITE_COGNITO_DOMAIN in .env.local for local dev)."
  value       = "${aws_cognito_user_pool_domain.users.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_client_id" {
  description = "Cognito app client ID. Set this as the COGNITO_CLIENT_ID repository variable (and VITE_COGNITO_CLIENT_ID in .env.local for local dev)."
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID, for finding the pool in the AWS console."
  value       = aws_cognito_user_pool.users.id
}

output "chat_api_url" {
  description = "AI chat API address. Set it as the CHAT_API_URL repository variable (and VITE_CHAT_API_URL in .env.local)."
  value       = var.enable_chat ? aws_apigatewayv2_api.chat[0].api_endpoint : ""
}

output "chat_key_parameter" {
  description = "SSM parameter to put the Anthropic API key in (see chat.tf)."
  value       = var.enable_chat ? aws_ssm_parameter.anthropic_key[0].name : ""
}

output "sync_api_url" {
  description = "Cloud history API address. Set it as the SYNC_API_URL repository variable (and VITE_SYNC_API_URL in .env.local)."
  value       = var.enable_cloud_history ? aws_apigatewayv2_api.sync[0].api_endpoint : ""
}
