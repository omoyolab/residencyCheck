provider "google" {
  project = "pay"
  region  = "europe-west2"
}

resource "google_sql_database_instance" "main" {
  database_version = "POSTGRES_16"
}

resource "google_sql_database_instance" "read" {
  region               = "europe-west1"
  master_instance_name = google_sql_database_instance.main.name
}

resource "google_bigquery_dataset" "analytics" {
  dataset_id = "analytics"
  location   = "EU"
}

resource "google_storage_bucket" "exports" {
  name     = "exports"
  location = "EUROPE-WEST2"
}
