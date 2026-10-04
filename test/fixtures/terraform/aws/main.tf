locals {
  policy = <<EOT
{ "Version": "2012-10-17", "Statement": [] }
EOT
  tags = {
    team = "payments"
  }
}

resource "aws_db_instance" "payments" {
  engine                  = "postgres"
  backup_retention_period = 7
}

resource "aws_db_instance" "payments_replica" {
  provider            = aws.dr
  replicate_source_db = aws_db_instance.payments.arn
}

resource "aws_db_instance_automated_backups_replication" "payments" {
  provider               = aws.dr
  source_db_instance_arn = aws_db_instance.payments.arn
}

resource "aws_s3_bucket" "statements" {}

resource "aws_s3_bucket" "statements_dr" {
  provider = aws.dr
}

resource "aws_s3_bucket_replication_configuration" "statements" {
  bucket = aws_s3_bucket.statements.id
  rule {
    id     = "all"
    status = "Enabled"
    destination {
      bucket = aws_s3_bucket.statements_dr.arn
    }
  }
}

resource "aws_dynamodb_table" "ledger" {
  name     = "ledger"
  hash_key = "id"
  attribute {
    name = "id"
    type = "S"
  }
  replica {
    region_name = "eu-central-1"
  }
}

resource "aws_iam_role" "lambda" {
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow" }]
  })
}

resource "aws_lambda_function" "api" {
  function_name = "api"
}

resource "aws_lambda_function" "worker" {
  function_name = "worker"
}
