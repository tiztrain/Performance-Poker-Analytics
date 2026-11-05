terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state is fine to get started - state just lives in this directory
  # (and is gitignored, since it can contain sensitive values). For a project
  # with more than one contributor or environment, swap this for an S3 backend:
  #
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "poker-hand-review/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront's ACM certificate requirement (for a custom domain) and some global
# resources must be requested from us-east-1 regardless of where everything else
# lives - this aliased provider is only used if a custom domain is configured.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
