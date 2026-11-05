# ---------- User accounts (Amazon Cognito) ----------
# A Cognito "user pool" is a managed user directory: it stores accounts, hashes
# passwords, sends verification and password-reset emails, and serves the login and
# sign-up pages. The site never sees a password - it redirects to Cognito's hosted
# pages and gets tokens back (see src/auth/oauth.js for the browser side).

locals {
  site_origin = local.use_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.site.domain_name}"

  # Cognito only redirects back to URLs on this list, so a malicious site can't
  # start a login and receive the user's tokens.
  auth_redirect_urls = concat(["${local.site_origin}/"], var.auth_dev_redirect_urls)
}

resource "aws_cognito_user_pool" "users" {
  name = "${var.project_name}-users"

  # Sign in with an email address rather than a separate username, and confirm the
  # address with an emailed code before the account can be used.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Cognito sends the emails itself. This is free but limited to 50 emails a day,
  # which is plenty for a personal project; switch to SES if that ever runs out.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Deleting the pool deletes every account in it, so `terraform destroy` refuses
  # until this is set to "INACTIVE" and applied first.
  deletion_protection = "ACTIVE"
}

# The address the hosted login pages are served from:
# https://<prefix>.auth.<region>.amazoncognito.com. The prefix must be unique per
# region, so the account ID is appended, as for the S3 bucket.
resource "aws_cognito_user_pool_domain" "users" {
  domain       = "${var.project_name}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.users.id
}

# The "app client" is the site's registration with the user pool.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # A browser app can't keep a secret (anyone can read its JavaScript), so this is a
  # "public client" with no secret. PKCE protects the login instead.
  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = local.auth_redirect_urls
  logout_urls                          = local.auth_redirect_urls

  # Only the hosted pages log users in; the app never sends passwords to the API.
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]

  # Login failures say "incorrect username or password" whether or not the account
  # exists, so the form can't be used to find out who has an account.
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}
