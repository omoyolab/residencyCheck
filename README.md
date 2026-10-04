# ResidencyCheck

**Know where your payment data lives before CBN asks.**

```
npx residencycheck scan .
```

On 15 June 2026 the Central Bank of Nigeria issued Circular PSS/DIR/PUB/CIR/001/004. Paragraph 2 requires that payments transaction data generated within Nigeria be stored and managed in Nigeria, effective **1 January 2027**.

ResidencyCheck scans your project's configuration and lists every place payment data may be stored or sent outside Nigeria. It checks your database, backups, error tracker, analytics, cache, hosting and payment processors.

It runs **entirely on your machine**. No network calls, no telemetry, no uploads. A test in this repo fails the build if network code is ever added.

## What it reads

| Source | Files |
|---|---|
| Environment | `.env`, `.env.*` (read even when gitignored) |
| Dependencies | `package.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile`, `go.mod` |
| Platform config | `vercel.json`, `render.yaml`, `fly.toml`, `railway.json`, `supabase/.temp/pooler-url` |
| Terraform | `*.tf`, `*.tfvars` for AWS, Google Cloud and Azure: databases, buckets, caches, queues, warehouses, hosting, **replicas and backups** (RDS read replicas, cross-region backup replication, S3 replication, DynamoDB global tables, Cloud SQL replicas, Cosmos DB geo-locations, Azure geo-redundancy). Follows provider aliases, variables, locals, local modules and common registry modules. |
| Schema | Prisma, SQL migrations, Drizzle |

Secret values are never printed. Evidence shows only key names and hostnames.

Anything the scanner sees but can't check, such as a Terraform module from an unrecognised source, is listed under **Not analysed**. Nothing passes silently.

## How to read the output

Every finding reports three separate things:

- **Location confidence**: how sure we are *where* the service is.
  - `KNOWN`: stated in your config.
  - `INFERRED`: taken from a vendor default.
  - `UNKNOWN`: we couldn't tell.
- **Payment relevance**: how likely it is that payment transaction data is involved (`HIGH` / `MEDIUM` / `LOW`).
- **Regulatory exposure**: our reading of the circular.

| Exposure | Meaning |
|---|---|
| `CLEAR` | Primary storage of payment records appears to be outside Nigeria |
| `LIKELY` | A copy (backup, replica, export) appears to be outside Nigeria |
| `UNCLEAR` | Data may pass through or be processed abroad; the circular doesn't address it |
| `VERIFY` | A third-party processor holds the data; only they can confirm where |
| `INFO` | Configured inside Nigeria |

ResidencyCheck gives no score and no "compliant" verdict. The circular is one paragraph and doesn't define backups, logs or processing abroad, so the output is an **exposure inventory**, not a compliance determination. Every explanation is labelled as our interpretation and cites the circular text. Run `residencycheck explain <RULE-ID>` to see both.

## CI

```
residencycheck scan . --fail-on likely   # exit 1 on CLEAR or LIKELY findings (default)
residencycheck scan . --json             # machine-readable output
```

## Contributing

Region maps and payment-data patterns are plain YAML in [`rules/`](rules/). Adding a provider region or a Nigerian hosting provider is a one-line PR.

## License

Apache-2.0
