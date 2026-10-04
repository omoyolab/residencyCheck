provider "aws" {
  region = "af-south-1"
}

provider "aws" {
  alias  = "london"
  region = "eu-west-2"
}

module "ledger_db" {
  source = "../modules/db"
}

module "ledger_db_replica" {
  source = "../modules/db"
  providers = {
    aws = aws.london
  }
  replicate_source_db = module.ledger_db.db_instance_arn
}

module "receipts" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.0"
}

module "network" {
  source = "terraform-aws-modules/vpc/aws"
}

module "mystery" {
  source = "git::https://example.com/internal-modules.git//payments"
}
