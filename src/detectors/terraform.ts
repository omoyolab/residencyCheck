import { posix } from "node:path";
import { awsCountry, regions } from "../rules.js";
import type { Evidence, LocationConfidence, Role, ServiceKind } from "../types.js";
import type { ScanContext } from "../walk.js";
import { descendants, parseHcl, type Attr, type Block } from "./hcl.js";
import type { Detected } from "./index.js";

type Cloud = "aws" | "google" | "azurerm";

interface TfRule {
  label: string;
  kind: ServiceKind;
  /** false: many instances collapse into one row (e.g. all Lambdas). */
  perResource?: boolean;
  role?: Role;
}

const SHARED = { perResource: false } as const;

const RESOURCES: Record<string, TfRule> = {
  // AWS
  aws_db_instance: { label: "RDS", kind: "database" },
  aws_rds_cluster: { label: "Aurora", kind: "database" },
  aws_docdb_cluster: { label: "DocumentDB", kind: "database" },
  aws_dynamodb_table: { label: "DynamoDB", kind: "database" },
  aws_s3_bucket: { label: "S3", kind: "storage" },
  aws_efs_file_system: { label: "EFS", kind: "storage" },
  aws_elasticache_cluster: { label: "ElastiCache", kind: "cache" },
  aws_elasticache_replication_group: { label: "ElastiCache", kind: "cache" },
  aws_elasticache_serverless_cache: { label: "ElastiCache", kind: "cache" },
  aws_memorydb_cluster: { label: "MemoryDB", kind: "cache" },
  aws_sqs_queue: { label: "SQS", kind: "queue", ...SHARED },
  aws_msk_cluster: { label: "MSK", kind: "queue" },
  aws_kinesis_stream: { label: "Kinesis", kind: "queue" },
  aws_redshift_cluster: { label: "Redshift", kind: "warehouse" },
  aws_redshiftserverless_workgroup: { label: "Redshift Serverless", kind: "warehouse" },
  aws_backup_vault: { label: "Backup vault", kind: "storage", role: "backup" },
  aws_db_instance_automated_backups_replication: { label: "RDS backup replication", kind: "database", role: "backup" },
  aws_cloudwatch_log_group: { label: "CloudWatch Logs", kind: "logging", ...SHARED },
  aws_instance: { label: "EC2", kind: "hosting", ...SHARED },
  aws_ecs_service: { label: "ECS", kind: "hosting", ...SHARED },
  aws_lambda_function: { label: "Lambda", kind: "hosting", ...SHARED },
  aws_eks_cluster: { label: "EKS", kind: "hosting", ...SHARED },
  aws_apprunner_service: { label: "App Runner", kind: "hosting", ...SHARED },
  aws_elastic_beanstalk_environment: { label: "Elastic Beanstalk", kind: "hosting", ...SHARED },
  // Google Cloud
  google_sql_database_instance: { label: "Cloud SQL", kind: "database" },
  google_firestore_database: { label: "Firestore", kind: "database" },
  google_storage_bucket: { label: "GCS", kind: "storage" },
  google_bigquery_dataset: { label: "BigQuery", kind: "warehouse" },
  google_redis_instance: { label: "Memorystore", kind: "cache" },
  google_cloud_run_service: { label: "Cloud Run", kind: "hosting", ...SHARED },
  google_cloud_run_v2_service: { label: "Cloud Run", kind: "hosting", ...SHARED },
  google_compute_instance: { label: "Compute Engine", kind: "hosting", ...SHARED },
  google_container_cluster: { label: "GKE", kind: "hosting", ...SHARED },
  google_cloudfunctions_function: { label: "Cloud Functions", kind: "hosting", ...SHARED },
  google_cloudfunctions2_function: { label: "Cloud Functions", kind: "hosting", ...SHARED },
  // Azure
  azurerm_postgresql_flexible_server: { label: "Azure PostgreSQL", kind: "database" },
  azurerm_postgresql_server: { label: "Azure PostgreSQL", kind: "database" },
  azurerm_mysql_flexible_server: { label: "Azure MySQL", kind: "database" },
  azurerm_mssql_server: { label: "Azure SQL", kind: "database" },
  azurerm_cosmosdb_account: { label: "Cosmos DB", kind: "database" },
  azurerm_storage_account: { label: "Storage account", kind: "storage" },
  azurerm_redis_cache: { label: "Azure Cache for Redis", kind: "cache" },
  azurerm_servicebus_namespace: { label: "Service Bus", kind: "queue" },
  azurerm_eventhub_namespace: { label: "Event Hubs", kind: "queue" },
  azurerm_synapse_workspace: { label: "Synapse", kind: "warehouse" },
  azurerm_linux_web_app: { label: "App Service", kind: "hosting", ...SHARED },
  azurerm_windows_web_app: { label: "App Service", kind: "hosting", ...SHARED },
  azurerm_app_service: { label: "App Service", kind: "hosting", ...SHARED },
  azurerm_container_app: { label: "Container Apps", kind: "hosting", ...SHARED },
  azurerm_kubernetes_cluster: { label: "AKS", kind: "hosting", ...SHARED },
  azurerm_linux_function_app: { label: "Azure Functions", kind: "hosting", ...SHARED },
  azurerm_log_analytics_workspace: { label: "Log Analytics", kind: "logging", ...SHARED },
};

const PROVIDER_NAME: Record<Cloud, string> = { aws: "AWS", google: "Google Cloud", azurerm: "Azure" };
const REGION_ATTRS: Record<Cloud, string[]> = {
  aws: ["region"],
  google: ["region", "location", "location_id", "zone"],
  azurerm: ["location"],
};

// Azure geo-redundant backups and GRS storage go to the region's documented pair.
const AZURE_PAIRS: Record<string, string> = {
  southafricanorth: "southafricawest", southafricawest: "southafricanorth",
  westeurope: "northeurope", northeurope: "westeurope",
  uksouth: "ukwest", ukwest: "uksouth",
  eastus: "westus", westus: "eastus",
  eastus2: "centralus", centralus: "eastus2",
  francecentral: "francesouth", germanywestcentral: "germanynorth",
  uaenorth: "uaecentral",
};

const GCP_MULTI: Record<string, string> = { us: "US", eu: "EU", nam4: "US", eur4: "EU", eur5: "EU", eur7: "EU", eur8: "EU" };

// Well-known registry modules, matched on `source`. null = known but holds no data we track.
const REGISTRY: { match: RegExp; cloud: Cloud; rule: TfRule | null }[] = [
  { match: /terraform-aws-modules\/(terraform-aws-)?rds-aurora\b/, cloud: "aws", rule: { label: "Aurora", kind: "database" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?rds\b/, cloud: "aws", rule: { label: "RDS", kind: "database" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?dynamodb-table\b/, cloud: "aws", rule: { label: "DynamoDB", kind: "database" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?s3-bucket\b/, cloud: "aws", rule: { label: "S3", kind: "storage" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?elasticache\b/, cloud: "aws", rule: { label: "ElastiCache", kind: "cache" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?memory-db\b/, cloud: "aws", rule: { label: "MemoryDB", kind: "cache" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?redshift\b/, cloud: "aws", rule: { label: "Redshift", kind: "warehouse" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?sqs\b/, cloud: "aws", rule: { label: "SQS", kind: "queue", ...SHARED } },
  { match: /terraform-aws-modules\/(terraform-aws-)?msk-kafka-cluster\b/, cloud: "aws", rule: { label: "MSK", kind: "queue" } },
  { match: /terraform-aws-modules\/(terraform-aws-)?lambda\b/, cloud: "aws", rule: { label: "Lambda", kind: "hosting", ...SHARED } },
  { match: /terraform-aws-modules\/(terraform-aws-)?ecs\b/, cloud: "aws", rule: { label: "ECS", kind: "hosting", ...SHARED } },
  { match: /terraform-aws-modules\/(terraform-aws-)?eks\b/, cloud: "aws", rule: { label: "EKS", kind: "hosting", ...SHARED } },
  { match: /terraform-aws-modules\/(terraform-aws-)?ec2-instance\b/, cloud: "aws", rule: { label: "EC2", kind: "hosting", ...SHARED } },
  { match: /terraform-aws-modules\/(terraform-aws-)?cloudwatch\b/, cloud: "aws", rule: { label: "CloudWatch Logs", kind: "logging", ...SHARED } },
  { match: /terraform-aws-modules\/(terraform-aws-)?(vpc|security-group|iam|kms|acm|route53|alb|elb|autoscaling|key-pair|cloudfront|apigateway-v2|sns|eventbridge|ssm-parameter|secrets-manager|step-functions|ecr|notify-slack|vpn-gateway|transit-gateway)\b/, cloud: "aws", rule: null },
  { match: /terraform-google-modules\/(terraform-google-)?sql-db\b/, cloud: "google", rule: { label: "Cloud SQL", kind: "database" } },
  { match: /terraform-google-modules\/(terraform-google-)?cloud-storage\b/, cloud: "google", rule: { label: "GCS", kind: "storage" } },
  { match: /terraform-google-modules\/(terraform-google-)?bigquery\b/, cloud: "google", rule: { label: "BigQuery", kind: "warehouse" } },
  { match: /terraform-google-modules\/(terraform-google-)?kubernetes-engine\b/, cloud: "google", rule: { label: "GKE", kind: "hosting", ...SHARED } },
  { match: /terraform-google-modules\/(terraform-google-)?(network|project-factory|iam|kms|service-accounts)\b/, cloud: "google", rule: null },
];

const CLOUDS: Cloud[] = ["aws", "google", "azurerm"];

interface Module {
  dir: string;
  resources: Block[];
  calls: Block[];
  providers: Block[];
  variables: Map<string, Block>;
  locals: Map<string, Attr & { file: string }>;
  /** terraform.tfvars and *.auto.tfvars: loaded automatically by Terraform. */
  autoVars: Map<string, Attr & { file: string }>;
  /** Other *.tfvars (per-environment files passed with -var-file). */
  otherVars: Map<string, (Attr & { file: string })[]>;
}

interface Resolved {
  value: string;
  confidence: Extract<LocationConfidence, "KNOWN" | "INFERRED">;
  evidence: Evidence[];
}

/** What a `module` call passes down to the resources it instantiates. */
interface CallContext {
  name: string;
  role?: Role;
  providers: Partial<Record<Cloud, Resolved>>;
  evidence: Evidence[];
}

interface Env {
  mod: Module;
  all: Module[];
  cloud: Cloud;
  /** Provider region handed down by a module call. */
  inherited?: Resolved;
}

const MAX_DEPTH = 8;

export function detectTerraform(ctx: ScanContext): { locations: Detected[]; notes: string[] } {
  const modules = loadModules(ctx);
  const all = [...modules.values()];
  const out: Detected[] = [];
  const notes: string[] = [];

  // Modules called from elsewhere in the repo are only emitted through their calls,
  // so each instantiation gets the caller's provider region.
  const instantiated = new Set<string>();
  for (const mod of all) {
    for (const call of mod.calls) {
      const dir = localDir(mod, call);
      if (dir && modules.has(dir)) instantiated.add(dir);
    }
  }

  const emitModule = (mod: Module, call: CallContext | undefined, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const replicaBuckets = s3ReplicationTargets(mod);
    for (const res of mod.resources) {
      const [type = "", name = ""] = res.labels;
      const cloud = cloudOf(type);
      const rule = RESOURCES[type];
      if (!cloud || !rule) continue;
      const env: Env = { mod, all, cloud, inherited: call?.providers[cloud] };

      let role = rule.role ?? call?.role ?? roleOf(res);
      const extra: Evidence[] = [...(call?.evidence ?? [])];
      const replication = replicaBuckets.get(name);
      if (type === "aws_s3_bucket" && replication) {
        role = "replica";
        extra.push(replication);
      }
      const site: Site = { block: res, address: `${type}.${name}`, name: call?.name ?? name };

      if (type === "azurerm_cosmosdb_account" && res.blocks.some((b) => b.type === "geo_location")) {
        out.push(...cosmosLocations(site, rule, env, extra));
        continue;
      }
      out.push(locate(site, rule, env, role, resourceRegion(res, env, 0), extra));
      out.push(...copies(site, rule, env, extra));
    }
    for (const c of mod.calls) handleCall(mod, c, call, depth);
  };

  const handleCall = (mod: Module, call: Block, parent: CallContext | undefined, depth: number) => {
    const callName = call.labels[0] ?? "?";
    const source = literal(call.attrs.get("source")?.raw) ?? "";
    const ev: Evidence = { file: call.file, line: call.line, snippet: `module.${callName} (source ${source})` };
    const context: CallContext = {
      name: parent?.name ?? callName,
      role: callRole(call) ?? parent?.role,
      providers: Object.fromEntries(
        CLOUDS.map((cloud) => [cloud, callProvider(mod, call, cloud, parent, all)]).filter(([, r]) => r),
      ),
      evidence: [...(parent?.evidence ?? []), ev],
    };

    const dir = localDir(mod, call);
    if (dir !== undefined) {
      const child = modules.get(dir);
      if (child) emitModule(child, context, depth + 1);
      else notes.push(`module.${callName}: local source "${source}" is outside the scanned folder, so its resources were not checked.`);
      return;
    }

    const known = REGISTRY.find((r) => r.match.test(source));
    if (!known) {
      notes.push(`module.${callName}: source "${source}" isn't recognised, so its resources were not checked.`);
      return;
    }
    if (!known.rule) return;
    const env: Env = { mod, all, cloud: known.cloud, inherited: context.providers[known.cloud] };
    const regionAttr = call.attrs.get("region");
    const region = (regionAttr && evaluate(regionAttr.raw, env, 0)) || context.providers[known.cloud];
    const site: Site = { block: call, address: `module.${callName}`, name: context.name };
    out.push(locate(site, known.rule, env, context.role, region, parent?.evidence ?? []));
  };

  for (const mod of all) {
    if (!instantiated.has(mod.dir)) emitModule(mod, undefined, 0);
  }
  return { locations: out, notes };
}

/** Directory of a local module source, relative to the scan root. */
function localDir(mod: Module, call: Block): string | undefined {
  const source = literal(call.attrs.get("source")?.raw);
  if (!source || !/^\.\.?\//.test(source)) return undefined;
  const dir = posix.normalize(posix.join(mod.dir, source)).replace(/\/+$/, "");
  return dir === "" ? "." : dir;
}

function callRole(call: Block): Role | undefined {
  for (const key of ["replicate_source_db", "replication_source_identifier"]) {
    const raw = call.attrs.get(key)?.raw;
    // `= var.x` inside a module just passes the caller's input through; the caller decides.
    if (raw && raw !== "null" && !/^var\./.test(raw)) return "replica";
  }
  return undefined;
}

/** Provider region for `cloud` inside a module call: explicit `providers = {}` map, else inherited, else caller default. */
function callProvider(mod: Module, call: Block, cloud: Cloud, parent: CallContext | undefined, all: Module[]): Resolved | undefined {
  const map = call.attrs.get("providers")?.raw ?? "";
  const alias = map.match(new RegExp(`\\b${cloud}\\s*=\\s*${cloud}\\.([\\w-]+)`))?.[1];
  const env: Env = { mod, all, cloud, inherited: parent?.providers[cloud] };
  if (alias) return providerRegion(alias, env, 0);
  return env.inherited ?? providerRegion(undefined, env, 0);
}

/** Where a location was declared: a resource, or a module call standing in for one. */
interface Site {
  block: Block;
  address: string;
  name: string;
}

function locate(site: Site, rule: TfRule, env: Env, role: Role | undefined, region: Resolved | undefined, extra: Evidence[] = []): Detected {
  const roleText = role && role !== rule.role ? ` (${role})` : "";
  const service = rule.perResource === false ? rule.label : `${rule.label} ${site.name}${roleText}`;
  const country = region ? countryOf(env.cloud, region.value) : undefined;
  const regionText = region ? normalizeRegion(env.cloud, region.value) : undefined;
  return {
    provider: PROVIDER_NAME[env.cloud],
    service,
    kind: rule.kind,
    role,
    region: regionText,
    country,
    locationConfidence: country && region ? region.confidence : "UNKNOWN",
    note: region
      ? country ? undefined : `Unrecognised region "${region.value}".`
      : "Region isn't set in the repo (likely supplied at apply time or by a parent module).",
    evidence: [
      { file: site.block.file, line: site.block.line, snippet: `${site.address}${regionText ? ` → ${regionText}` : ""}` },
      ...(region?.evidence ?? []),
      ...extra,
    ],
  };
}

// --- copies: replicas and backups declared on a resource ---------------------

function roleOf(res: Block): Role | undefined {
  const [type] = res.labels;
  // Module code passes these through (`= var.replicate_source_db`); only a concrete value marks a replica.
  const has = (k: string) => {
    const raw = res.attrs.get(k)?.raw;
    return !!raw && raw !== "null" && !/^var\./.test(raw);
  };
  if (type === "aws_db_instance" && has("replicate_source_db")) return "replica";
  if (type === "aws_rds_cluster" && has("replication_source_identifier")) return "replica";
  if (type === "google_sql_database_instance" && has("master_instance_name")) return "replica";
  if (type?.startsWith("azurerm_") && /replica/i.test(res.attrs.get("create_mode")?.raw ?? "")) return "replica";
  return undefined;
}

function copies(site: Site, rule: TfRule, env: Env, extra: Evidence[]): Detected[] {
  const res = site.block;
  const [type] = res.labels;
  const out: Detected[] = [];

  if (type === "aws_dynamodb_table") {
    for (const replica of res.blocks.filter((b) => b.type === "replica")) {
      const attr = replica.attrs.get("region_name");
      const region = attr ? evaluate(attr.raw, env, 0) : undefined;
      const ev = { file: res.file, line: replica.line, snippet: `replica { region_name = ${attr?.raw ?? "?"} }` };
      out.push(locate(site, rule, env, "replica", region && { ...region, evidence: [ev, ...region.evidence] }, extra));
    }
  }

  if (env.cloud === "azurerm") {
    const geoBackup = /^true$/.test(res.attrs.get("geo_redundant_backup_enabled")?.raw ?? "");
    const grs = /GRS|GZRS/.test(res.attrs.get("account_replication_type")?.raw ?? "");
    if (geoBackup || grs) {
      const role: Role = geoBackup ? "backup" : "replica";
      const primary = resourceRegion(res, env, 0);
      const pair = primary ? AZURE_PAIRS[normalizeRegion("azurerm", primary.value)] : undefined;
      const attrName = geoBackup ? "geo_redundant_backup_enabled" : "account_replication_type";
      const ev = { file: res.file, line: res.attrs.get(attrName)!.line, snippet: `${attrName} = ${res.attrs.get(attrName)!.raw}` };
      const loc = locate(site, rule, env, role, pair ? { value: pair, confidence: "INFERRED", evidence: [ev] } : undefined, pair ? extra : [ev, ...extra]);
      loc.note = pair
        ? `Azure stores this copy in the paired region of ${primary!.value}.`
        : "Azure stores this copy in the primary region's paired region, which we couldn't determine.";
      out.push(loc);
    }
  }
  return out;
}

function cosmosLocations(site: Site, rule: TfRule, env: Env, extra: Evidence[]): Detected[] {
  const res = site.block;
  return res.blocks
    .filter((b) => b.type === "geo_location")
    .map((geo) => {
      const attr = geo.attrs.get("location");
      const region = attr ? evaluate(attr.raw, env, 0) : undefined;
      const primary = (geo.attrs.get("failover_priority")?.raw ?? "0") === "0";
      const ev = { file: res.file, line: geo.line, snippet: `geo_location ${attr?.raw ?? "?"} (failover_priority ${geo.attrs.get("failover_priority")?.raw ?? "0"})` };
      return locate(site, rule, env, primary ? undefined : "replica", region && { ...region, evidence: [ev, ...region.evidence] }, extra);
    });
}

/** aws_s3_bucket name → replication config that targets it. */
function s3ReplicationTargets(mod: Module): Map<string, Evidence> {
  const targets = new Map<string, Evidence>();
  for (const res of mod.resources.filter((r) => r.labels[0] === "aws_s3_bucket_replication_configuration")) {
    for (const dest of descendants(res, "destination")) {
      const bucket = dest.attrs.get("bucket")?.raw.match(/aws_s3_bucket\.([\w-]+)\./)?.[1];
      if (bucket) targets.set(bucket, { file: res.file, line: dest.line, snippet: `replication destination aws_s3_bucket.${bucket}` });
    }
  }
  return targets;
}

// --- region resolution --------------------------------------------------------

function resourceRegion(res: Block, env: Env, depth: number): Resolved | undefined {
  if (depth > MAX_DEPTH) return undefined;
  for (const key of REGION_ATTRS[env.cloud]) {
    const attr = res.attrs.get(key);
    if (attr) {
      const r = evaluate(attr.raw, env, depth + 1);
      if (r) return r;
    }
  }
  if (env.cloud === "azurerm") return undefined;
  const alias = res.attrs.get("provider")?.raw.trim().split(".")[1];
  if (!alias && env.inherited) return env.inherited;
  return providerRegion(alias, env, depth + 1);
}

function providerRegion(alias: string | undefined, env: Env, depth: number): Resolved | undefined {
  const matches = (p: Block) =>
    p.labels[0] === env.cloud &&
    (alias ? literal(p.attrs.get("alias")?.raw) === alias : !p.attrs.has("alias"));

  const fromModule = (mod: Module): Resolved | undefined => {
    const p = mod.providers.find(matches);
    const attr = p?.attrs.get("region");
    if (!p || !attr) return undefined;
    const r = evaluate(attr.raw, { ...env, mod }, depth + 1);
    if (!r) return undefined;
    const label = `provider "${env.cloud}"${alias ? ` (alias ${alias})` : ""}`;
    return { ...r, evidence: [{ file: p.file, line: attr.line, snippet: `${label} region = ${attr.raw}` }, ...r.evidence] };
  };

  const local = fromModule(env.mod);
  if (local) return local;
  // Child modules inherit providers from the root; take it if the repo agrees on one.
  const candidates = env.all.filter((m) => m !== env.mod).map(fromModule).filter((r): r is Resolved => !!r);
  const distinct = new Set(candidates.map((c) => c.value));
  if (distinct.size === 1) return { ...candidates[0]!, confidence: "INFERRED" };
  return undefined;
}

function evaluate(raw: string, env: Env, depth: number): Resolved | undefined {
  if (depth > MAX_DEPTH) return undefined;
  let v = raw.trim();
  const interpolated = v.match(/^"\$\{([^}]+)\}"$/);
  if (interpolated) v = interpolated[1]!.trim();

  const lit = literal(v);
  if (lit !== undefined) return { value: lit, confidence: "KNOWN", evidence: [] };

  let m: RegExpMatchArray | null;
  if ((m = v.match(/^var\.([\w-]+)$/))) return resolveVar(m[1]!, env, depth);
  if ((m = v.match(/^local\.([\w-]+)$/))) {
    const attr = env.mod.locals.get(m[1]!);
    const r = attr && evaluate(attr.raw, env, depth + 1);
    return r && { ...r, evidence: [{ file: attr.file, line: attr.line, snippet: `local.${m[1]} = ${attr.raw}` }, ...r.evidence] };
  }
  if ((m = v.match(/^([a-z][\w]*)\.([\w-]+)\.([\w]+)$/))) {
    const [, type, name, key] = m;
    const target = env.mod.resources.find((r) => r.labels[0] === type && r.labels[1] === name);
    if (!target) return undefined;
    const attr = target.attrs.get(key!);
    if (attr) return evaluate(attr.raw, env, depth + 1);
    if (key === "region" || key === "location") return resourceRegion(target, env, depth + 1);
  }
  return undefined;
}

function resolveVar(name: string, env: Env, depth: number): Resolved | undefined {
  const withEvidence = (attr: Attr & { file: string }, confidence: Resolved["confidence"]) => {
    const r = evaluate(attr.raw, env, depth + 1);
    return r && { value: r.value, confidence, evidence: [{ file: attr.file, line: attr.line, snippet: `${name} = ${attr.raw}` }, ...r.evidence] };
  };

  const auto = env.mod.autoVars.get(name);
  if (auto) return withEvidence(auto, "KNOWN");

  // Per-environment tfvars: only usable if they all agree.
  const others = env.mod.otherVars.get(name) ?? [];
  const values = new Set(others.map((o) => literal(o.raw)).filter(Boolean));
  if (values.size === 1) return withEvidence(others[0]!, "INFERRED");

  const variable = env.mod.variables.get(name);
  const def = variable?.attrs.get("default");
  if (variable && def && values.size === 0) {
    // Defaults can be overridden at apply time.
    return withEvidence({ ...def, file: variable.file }, "INFERRED");
  }
  return undefined;
}

function literal(raw: string | undefined): string | undefined {
  const m = raw?.trim().match(/^"([^"$]*)"$/);
  return m?.[1];
}

// --- region → country ---------------------------------------------------------

function normalizeRegion(cloud: Cloud, value: string): string {
  const v = value.toLowerCase();
  if (cloud === "azurerm") return v.replace(/\s+/g, "");
  if (cloud === "google") return v.replace(/-[a-z]$/, ""); // zone → region
  return v;
}

function countryOf(cloud: Cloud, value: string): string | undefined {
  const region = normalizeRegion(cloud, value);
  if (cloud === "aws") return awsCountry(region);
  if (cloud === "google") return regions.gcp[region] ?? GCP_MULTI[region];
  return regions.azure[region];
}

function cloudOf(type: string): Cloud | undefined {
  if (type.startsWith("aws_")) return "aws";
  if (type.startsWith("google_")) return "google";
  if (type.startsWith("azurerm_")) return "azurerm";
  return undefined;
}

// --- loading ------------------------------------------------------------------

function loadModules(ctx: ScanContext): Map<string, Module> {
  const modules = new Map<string, Module>();
  const get = (dir: string): Module => {
    let mod = modules.get(dir);
    if (!mod) {
      mod = { dir, resources: [], calls: [], providers: [], variables: new Map(), locals: new Map(), autoVars: new Map(), otherVars: new Map() };
      modules.set(dir, mod);
    }
    return mod;
  };

  for (const file of ctx.files) {
    const isTf = file.endsWith(".tf");
    const isVars = file.endsWith(".tfvars");
    if (!isTf && !isVars) continue;
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
    const mod = get(dir);
    let root: Block;
    try {
      root = parseHcl(ctx.read(file), file);
    } catch {
      continue;
    }

    if (isVars) {
      const name = file.split("/").pop()!;
      const auto = name === "terraform.tfvars" || name.endsWith(".auto.tfvars");
      for (const [key, attr] of root.attrs) {
        const entry = { ...attr, file };
        if (auto) mod.autoVars.set(key, entry);
        else mod.otherVars.set(key, [...(mod.otherVars.get(key) ?? []), entry]);
      }
      continue;
    }

    for (const b of root.blocks) {
      if (b.type === "resource" && b.labels.length >= 2) mod.resources.push(b);
      else if (b.type === "module" && b.labels[0]) mod.calls.push(b);
      else if (b.type === "provider") mod.providers.push(b);
      else if (b.type === "variable" && b.labels[0]) mod.variables.set(b.labels[0], b);
      else if (b.type === "locals") for (const [k, a] of b.attrs) mod.locals.set(k, { ...a, file });
    }
  }
  return modules;
}
