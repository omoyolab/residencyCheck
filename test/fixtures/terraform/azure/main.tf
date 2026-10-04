resource "azurerm_resource_group" "rg" {
  name     = "payments"
  location = "South Africa North"
}

resource "azurerm_postgresql_flexible_server" "pg" {
  name                         = "payments-pg"
  location                     = azurerm_resource_group.rg.location
  geo_redundant_backup_enabled = true
}

resource "azurerm_storage_account" "receipts" {
  location                 = azurerm_resource_group.rg.location
  account_replication_type = "GRS"
}

resource "azurerm_cosmosdb_account" "events" {
  geo_location {
    location          = "westeurope"
    failover_priority = 0
  }
  geo_location {
    location          = "northeurope"
    failover_priority = 1
  }
}
