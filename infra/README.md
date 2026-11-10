# Infrastructure

Terraform config for hosting the built site on AWS: a private S3 bucket fronted by
CloudFront, plus a GitHub Actions deploy role that authenticates via OIDC (no AWS
access keys stored in GitHub).

```
S3 (private bucket)  <--(Origin Access Control)--  CloudFront (HTTPS, cached)
        ^
        | s3 sync + cache invalidation, via a short-lived OIDC token
        |
GitHub Actions (main branch push)
```

Cost: with the default `*.cloudfront.net` URL this is effectively free - S3 storage
for a few hundred KB of static assets is a fraction of a cent/month, and CloudFront's
first 1TB/month of data transfer and first 10,000,000 requests/month are permanently
free, not a 12-month trial. A custom domain adds ~$12-15/year for registration plus
~$0.50/month for the Route 53 hosted zone, if you choose to configure one.

This directory is something you run **once, yourself**, with your own AWS
credentials, to create the bucket/distribution/role. It is not run by CI - GitHub
Actions only ever deploys _into_ the infrastructure this creates, it never creates
or changes the infrastructure itself.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.6.0
- An AWS account and credentials available to the AWS provider (e.g. `aws configure`,
  or environment variables - anything the [standard provider auth
  chain](https://registry.terraform.io/providers/hashicorp/aws/latest/docs#authentication)
  picks up)
- Your GitHub username and the name you'll give the repo

## Usage

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: set github_owner and github_repo at minimum

terraform init
terraform plan   # review what it's about to create
terraform apply
```

`terraform apply` prints outputs when it finishes. You'll need four of them for the
next step (setting up the deploy workflow):

| Output                       | Goes into GitHub secret  |
| ---------------------------- | ------------------------ |
| `github_deploy_role_arn`     | `AWS_DEPLOY_ROLE_ARN`    |
| `bucket_name`                | `AWS_S3_BUCKET`          |
| `cloudfront_distribution_id` | `AWS_CLOUDFRONT_DIST_ID` |
| `aws_region`                 | `AWS_REGION`             |

Set these as repository secrets under the GitHub repo's **Settings → Secrets and
variables → Actions**. The deploy job deliberately doesn't use a GitHub environment:
that would change the subject in its OIDC token to `environment:<name>`, which the
deploy role's branch-based trust policy doesn't accept.

Once they're set, pushes to `main` will lint, format-check, test, build, and deploy
automatically.

`site_url` in the output is where the site will be reachable once the first deploy
has run.

### Turning on login

The same `apply` creates a Cognito user pool for accounts (`auth.tf`). To show the
sign-in buttons on the live site, set two more outputs as repository **variables**
(the **Variables** tab next to Secrets, since neither is secret: both end up in the
public JavaScript):

| Output              | Goes into GitHub variable |
| ------------------- | ------------------------- |
| `cognito_domain`    | `COGNITO_DOMAIN`          |
| `cognito_client_id` | `COGNITO_CLIENT_ID`       |

The next deploy picks them up. Until they're set, the site builds and works without
login. For local dev, put the same values in `.env.local` (see `.env.example`); the
pool allows `http://localhost:5173/` as a redirect through `auth_dev_redirect_urls`.

Cognito sends verification emails itself, which is limited to 50 a day. If the site
uses a custom domain, `apply` again after changing `domain_name` so the allowed
redirect URLs follow.

### Turning on the AI chat

The **Discuss with Claude** chat needs a small backend (`chat.tf`): API Gateway checks the
Cognito login, a Lambda function enforces the limits and calls Claude, DynamoDB counts
messages and spend, SSM Parameter Store holds the API key (encrypted), and SNS emails you
budget alerts. At personal-use volumes the AWS side stays within free tiers; the cost is the
Claude usage itself, capped by the budget below. It's off until you switch it on:

1. **Create an API key** in the [Anthropic Console](https://console.anthropic.com/) (API
   Keys). Under Limits, set a monthly spend limit of $10 on its workspace. That's the hard
   backstop: the API stops answering when it's reached, whatever the app does.
2. **Build the Lambda code**, from the project folder:
   ```powershell
   npm install
   npm run build:chat
   ```
   This creates `infra/build/chat-lambda.zip` (not committed).
3. **Switch it on** in `infra/terraform.tfvars`:
   ```hcl
   enable_chat = true
   alert_email = "you@example.com" # budget alerts at 50%, 80% and 100%
   ```
   Optional: `chat_model`, `chat_monthly_budget_usd` (default 10), `chat_free_daily_limit`
   (default 3) and `chat_full_daily_limit` (default 30).
4. **Apply**, from `infra/`: `terraform plan`, check it only adds chat resources, then
   `terraform apply`. AWS emails `alert_email` a confirmation link: click it, or alerts
   won't arrive.
5. **Store the key** (it never goes in Terraform state or the repo):
   ```powershell
   aws ssm put-parameter --name (terraform output -raw chat_key_parameter) --type SecureString --overwrite --value "sk-ant-..."
   ```
6. **Give yourself the full tier** (everyone else who signs up is on the free tier):
   ```powershell
   aws cognito-idp admin-add-user-to-group --user-pool-id (terraform output -raw cognito_user_pool_id) --username you@example.com --group-name full
   ```
   Sign out and back in afterwards, so your login token includes the group.
7. **Point the site at it:** add the repository variable `CHAT_API_URL` with the value of
   `terraform output -raw chat_api_url`, then run the **Deploy** workflow. For local dev, put
   the same value in `.env.local` as `VITE_CHAT_API_URL`.

The budget in the app is an estimate from token counts reported by the API; the Console
spend limit is what actually stops charges. After changing the chat code, run
`npm run build:chat` and `terraform apply` again to redeploy it.

## Notes / things worth knowing

- **State is local** (a `terraform.tfstate` file in this directory, gitignored). Fine
  for a single-person portfolio project. If you ever collaborate with others or want
  state locking, swap the commented-out `backend "s3"` block in `versions.tf` for a
  real S3 backend bucket.
- **`create_oidc_provider`**: an AWS account can only have _one_ OIDC provider
  registered per URL. If you've already set up GitHub Actions OIDC for another
  project in this same AWS account, set `create_oidc_provider = false` and
  `existing_oidc_provider_arn` to that provider's ARN instead - otherwise `apply`
  will fail with `EntityAlreadyExists`.
- **The deploy role is scoped tightly**: its trust policy only allows
  `sts:AssumeRoleWithWebIdentity` from this repo on the exact branch in `github_branch`
  (default `main`) - a workflow run from a fork or a PR branch cannot assume it. Its
  permissions policy only allows writing to this one S3 bucket and invalidating this
  one CloudFront distribution, nothing else in the account.
- **The trust policy uses GitHub's immutable subject format**:
  `repo:<owner>@<owner-id>/<repo>@<repo-id>:ref:refs/heads/<branch>`. GitHub repos
  created after 15 July 2026 use this by default. Older repos keep
  `repo:<owner>/<repo>:ref:refs/heads/<branch>` unless they opt in, so this config
  would need changing for one of those. A mismatch shows up as `Not authorized to
perform sts:AssumeRoleWithWebIdentity` in the deploy workflow.
- **Custom domain is optional and off by default.** Leave `domain_name` blank to use
  the free `*.cloudfront.net` URL. If you do set it, also set `route53_zone_id` if you
  want Terraform to create the DNS record and validate the ACM certificate
  automatically; otherwise you'll need to validate/point DNS manually.
- `terraform fmt` and `terraform validate` pass against the pinned provider, but the
  config hasn't been `plan`ned against a real account from the sandbox it was written
  in. Review `terraform plan` before every `apply`.

## Tearing it down

The user pool has deletion protection on, because deleting it deletes every account.
Set `deletion_protection = "INACTIVE"` in `auth.tf` and `apply` before destroying.

```bash
terraform destroy
```

S3 buckets with objects in them can refuse to delete via `destroy` in some Terraform
versions - if that happens, empty the bucket first (`aws s3 rm s3://<bucket-name>
--recursive`) and re-run `destroy`.
