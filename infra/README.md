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

`terraform apply` prints outputs when it finishes. You'll need three of them for the
next step (setting up the deploy workflow):

| Output                       | Goes into GitHub secret  |
| ---------------------------- | ------------------------ |
| `github_deploy_role_arn`     | `AWS_DEPLOY_ROLE_ARN`    |
| `bucket_name`                | `AWS_S3_BUCKET`          |
| `cloudfront_distribution_id` | `AWS_CLOUDFRONT_DIST_ID` |
| `aws_region`                 | `AWS_REGION`             |

Set these under the GitHub repo's **Settings → Secrets and variables → Actions**.
The deploy workflow (`.github/workflows/deploy.yml`) targets a GitHub
[environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
called `production` - GitHub creates this automatically the first time the workflow
runs, or you can create it yourself under **Settings → Environments** first if you
want to add protection rules (e.g. requiring manual approval before every deploy).
You can set the four secrets above either as plain repository secrets or scoped to
the `production` environment - either works with this workflow.

Once they're set, pushes to `main` will lint, format-check, test, build, and deploy
automatically.

`site_url` in the output is where the site will be reachable once the first deploy
has run.

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
  `sts:AssumeRoleWithWebIdentity` from `repo:<github_owner>/<github_repo>` on the
  exact branch in `github_branch` (default `main`) - a workflow run from a fork or a
  PR branch cannot assume it. Its permissions policy only allows writing to this one
  S3 bucket and invalidating this one CloudFront distribution, nothing else in the
  account.
- **Custom domain is optional and off by default.** Leave `domain_name` blank to use
  the free `*.cloudfront.net` URL. If you do set it, also set `route53_zone_id` if you
  want Terraform to create the DNS record and validate the ACM certificate
  automatically; otherwise you'll need to validate/point DNS manually.
- I wrote and reviewed this HCL carefully, but `terraform` wasn't available in the
  sandbox this was built in, so I was not able to run `terraform validate` or
  `terraform fmt` against it. Run both yourself as the first step after `terraform
init`, before `plan`/`apply` - they're fast, and `fmt` will just clean up
  whitespace/alignment if anything's off.

## Tearing it down

```bash
terraform destroy
```

S3 buckets with objects in them can refuse to delete via `destroy` in some Terraform
versions - if that happens, empty the bucket first (`aws s3 rm s3://<bucket-name>
--recursive`) and re-run `destroy`.
