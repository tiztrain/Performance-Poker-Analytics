# ---------- Cloud history (optional, off until enable_cloud_history = true) ----------
# Saves each signed-in user's hands and settings to their own folder in a private S3 bucket, so
# their history follows them across devices. Same pattern as the AI chat (chat.tf):
#   - API Gateway (HTTP API) checks the Cognito login token before anything runs
#   - Lambda reads and writes only the folder named after the token's user ID
#   - S3 holds the data, private and encrypted at rest
# Build the code first with `npm run build:lambdas` (creates infra/build/sync-lambda.zip).

locals {
  history = var.enable_cloud_history ? 1 : 0
}

resource "aws_s3_bucket" "history" {
  count  = local.history
  bucket = "${var.project_name}-history-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "history" {
  count                   = local.history
  bucket                  = aws_s3_bucket.history[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "history" {
  count  = local.history
  bucket = aws_s3_bucket.history[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Keeps old versions for 30 days, so an accidental overwrite of settings can be undone.
resource "aws_s3_bucket_versioning" "history" {
  count  = local.history
  bucket = aws_s3_bucket.history[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "history" {
  count  = local.history
  bucket = aws_s3_bucket.history[0].id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.history]
}

resource "aws_iam_role" "sync" {
  count              = local.history
  name               = "${var.project_name}-sync-lambda"
  assume_role_policy = data.aws_iam_policy_document.chat_assume.json
}

data "aws_iam_policy_document" "sync_permissions" {
  count = local.history
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.history[0].arn}/users/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.history[0].arn]
  }
  statement {
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "sync" {
  count  = local.history
  name   = "${var.project_name}-sync-permissions"
  role   = aws_iam_role.sync[0].id
  policy = data.aws_iam_policy_document.sync_permissions[0].json
}

resource "aws_lambda_function" "sync" {
  count            = local.history
  function_name    = "${var.project_name}-sync"
  role             = aws_iam_role.sync[0].arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = "${path.module}/build/sync-lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/build/sync-lambda.zip")
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      HISTORY_BUCKET = aws_s3_bucket.history[0].bucket
    }
  }
}

resource "aws_cloudwatch_log_group" "sync" {
  count             = local.history
  name              = "/aws/lambda/${var.project_name}-sync"
  retention_in_days = 14
}

resource "aws_apigatewayv2_api" "sync" {
  count         = local.history
  name          = "${var.project_name}-sync"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = local.chat_origins
    allow_methods = ["GET", "POST", "PUT"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "sync" {
  count            = local.history
  api_id           = aws_apigatewayv2_api.sync[0].id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    issuer   = local.cognito_issuer
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_integration" "sync" {
  count                  = local.history
  api_id                 = aws_apigatewayv2_api.sync[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sync[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sync" {
  for_each           = var.enable_cloud_history ? toset(["GET /sync", "GET /sync/chunk/{name}", "POST /sync/chunk", "PUT /sync/settings"]) : toset([])
  api_id             = aws_apigatewayv2_api.sync[0].id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.sync[0].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.sync[0].id
}

resource "aws_apigatewayv2_stage" "sync" {
  count       = local.history
  api_id      = aws_apigatewayv2_api.sync[0].id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 20
  }
}

resource "aws_lambda_permission" "sync" {
  count         = local.history
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.sync[0].execution_arn}/*/*"
}
