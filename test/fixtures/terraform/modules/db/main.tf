variable "replicate_source_db" {
  default = null
}

resource "aws_db_instance" "this" {
  engine              = "postgres"
  replicate_source_db = var.replicate_source_db
}
