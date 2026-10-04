provider "aws" {
  region = var.region
}

# DR copies go to Ireland
provider "aws" {
  alias  = "dr"
  region = "eu-west-1"
}
