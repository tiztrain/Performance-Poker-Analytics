# ---------- AI chat backend (optional, off until enable_chat = true) ----------
# The browser never holds the Anthropic API key. It sends chat messages to this API, which:
#   - API Gateway (HTTP API): checks the Cognito login token's signature before anything runs
#   - Lambda: enforces daily message limits and the monthly budget, then calls Claude
#   - SSM Parameter Store: holds the API key, encrypted (you put the value in by hand, below)
#   - DynamoDB: counts messages per user per day and spend per month
#   - SNS: emails you when spend passes 50%, 80% and 100% of the budget
# Build the code first with `npm run build:chat` (creates infra/build/chat-lambda.zip).

locals {
  chat           = var.enable_chat ? 1 : 0
  chat_origins   = [for u in local.auth_redirect_urls : trimsuffix(u, "/")]
  cognito_issuer = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
}

# Members of this group get the higher daily limit. Add yourself with:
#   aws cognito-idp admin-add-user-to-group --user-pool-id <pool id> --username <your email> --group-name full
resource "aws_cognito_user_group" "full" {
  name         = "full"
  user_pool_id = aws_cognito_user_pool.users.id
  description  = "Higher AI chat daily limit"
}

# The API key. Terraform creates the parameter with a placeholder and never overwrites it, so
# the real key is never in Terraform state or this repo. Set it with:
#   aws ssm put-parameter --name /<project>/anthropic-api-key --type SecureString --overwrite --value <key>
resource "aws_ssm_parameter" "anthropic_key" {
  count = local.chat
  name  = "/${var.project_name}/anthropic-api-key"
  type  = "SecureString"
  value = "set-me"
  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_dynamodb_table" "chat" {
  count        = local.chat
  name         = "${var.project_name}-chat"
  billing_mode = "PAY_PER_REQUEST" # pay per read/write; effectively free at this volume
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  # Daily counters carry an expiry time; DynamoDB deletes them automatically.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

resource "aws_sns_topic" "chat_alerts" {
  count = local.chat
  name  = "${var.project_name}-chat-alerts"
}

# AWS emails a confirmation link first; alerts only arrive after you click it.
resource "aws_sns_topic_subscription" "chat_alerts_email" {
  count     = var.enable_chat && var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.chat_alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------- Lambda ----------
data "aws_iam_policy_document" "chat_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "chat" {
  count              = local.chat
  name               = "${var.project_name}-chat-lambda"
  assume_role_policy = data.aws_iam_policy_document.chat_assume.json
}

# Least privilege: this one parameter, this one table, this one topic, and its own logs.
data "aws_iam_policy_document" "chat_permissions" {
  count = local.chat
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.anthropic_key[0].arn]
  }
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.chat[0].arn]
  }
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.chat_alerts[0].arn]
  }
  statement {
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*"]
  }
}

resource "aws_iam_role_policy" "chat" {
  count  = local.chat
  name   = "${var.project_name}-chat-permissions"
  role   = aws_iam_role.chat[0].id
  policy = data.aws_iam_policy_document.chat_permissions[0].json
}

resource "aws_lambda_function" "chat" {
  count            = local.chat
  function_name    = "${var.project_name}-chat"
  role             = aws_iam_role.chat[0].arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = "${path.module}/build/chat-lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/build/chat-lambda.zip")
  timeout          = 30 # API Gateway gives up after 30 seconds anyway
  memory_size      = 256

  environment {
    variables = {
      CHAT_PROVIDER       = "anthropic"
      CHAT_MODEL          = var.chat_model
      CHAT_TABLE          = aws_dynamodb_table.chat[0].name
      ANTHROPIC_KEY_PARAM = aws_ssm_parameter.anthropic_key[0].name
      ALERT_TOPIC_ARN     = aws_sns_topic.chat_alerts[0].arn
      MONTHLY_BUDGET_USD  = tostring(var.chat_monthly_budget_usd)
      FREE_DAILY_LIMIT    = tostring(var.chat_free_daily_limit)
      FULL_DAILY_LIMIT    = tostring(var.chat_full_daily_limit)
    }
  }
}

resource "aws_cloudwatch_log_group" "chat" {
  count             = local.chat
  name              = "/aws/lambda/${var.project_name}-chat"
  retention_in_days = 14
}

# ---------- API Gateway ----------
resource "aws_apigatewayv2_api" "chat" {
  count         = local.chat
  name          = "${var.project_name}-chat"
  protocol_type = "HTTP"

  # Only the site (and the local dev server) may call it from a browser.
  cors_configuration {
    allow_origins = local.chat_origins
    allow_methods = ["POST"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

# Checks the Cognito access token's signature, expiry and app client before the Lambda runs.
resource "aws_apigatewayv2_authorizer" "cognito" {
  count            = local.chat
  api_id           = aws_apigatewayv2_api.chat[0].id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = local.cognito_issuer
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_integration" "chat" {
  count                  = local.chat
  api_id                 = aws_apigatewayv2_api.chat[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.chat[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "chat" {
  count              = local.chat
  api_id             = aws_apigatewayv2_api.chat[0].id
  route_key          = "POST /chat"
  target             = "integrations/${aws_apigatewayv2_integration.chat[0].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito[0].id
}

resource "aws_apigatewayv2_stage" "chat" {
  count       = local.chat
  api_id      = aws_apigatewayv2_api.chat[0].id
  name        = "$default"
  auto_deploy = true

  # A safety net on top of the per-user limits: at most 2 requests a second, bursts of 5.
  default_route_settings {
    throttling_rate_limit  = 2
    throttling_burst_limit = 5
  }
}

resource "aws_lambda_permission" "chat" {
  count         = local.chat
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.chat[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.chat[0].execution_arn}/*/*"
}
