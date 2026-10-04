import { awsCountry, regions } from "./rules.js";
import type { Location, ServiceKind } from "./types.js";

export type LocationBase = Omit<Location, "evidence">;

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\]|host\.docker\.internal)$/;
const AWS_REGION = /(?:^|[.-])((?:us|eu|ap|sa|ca|me|af|il|mx)-(?:north|south|east|west|central|northeast|southeast|northwest|southwest)-\d(?:-[a-z]{3}-\d)?)[a-z]?(?=[.-]|$)/; // optional Local Zone suffix, e.g. af-south-1-los-1a

export function hostOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname) return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    // not a URL; fall through to bare hostname
  }
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function findAwsRegion(host: string): string | undefined {
  return host.match(AWS_REGION)?.[1];
}

export function awsLocation(provider: string, service: string, kind: ServiceKind, region: string): LocationBase {
  const country = awsCountry(region);
  return { provider, service, kind, region, country, locationConfidence: country ? "KNOWN" : "UNKNOWN" };
}

export function regionLocation(
  provider: string,
  service: string,
  kind: ServiceKind,
  region: string,
  table: Record<string, string>,
  confidence: "KNOWN" | "INFERRED" = "KNOWN",
): LocationBase {
  const country = table[region];
  return { provider, service, kind, region, country, locationConfidence: country ? confidence : "UNKNOWN" };
}

function unknown(provider: string, service: string, kind: ServiceKind, note?: string): LocationBase {
  return { provider, service, kind, locationConfidence: "UNKNOWN", note };
}

/** Classify a datastore host. Returns null for local development hosts. */
export function classifyHost(rawHost: string, kind: ServiceKind): LocationBase | null {
  const host = rawHost.toLowerCase();
  if (LOCAL_HOST.test(host) || !host.includes(".")) return null; // local dev or docker service name
  let m: RegExpMatchArray | null;

  if ((m = host.match(/^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/))) {
    return awsLocation("Supabase", "Supabase Postgres", kind, m[1]!);
  }
  if (host.endsWith(".supabase.co") || host.endsWith(".supabase.com")) {
    return unknown("Supabase", "Supabase Postgres", kind,
      "The project hostname doesn't reveal the region. Run `supabase link` (creates supabase/.temp/pooler-url) or check Project Settings → General.");
  }
  if ((m = host.match(/\.([a-z0-9-]+)\.rds\.amazonaws\.com$/))) {
    return awsLocation("AWS", "Amazon RDS", kind, m[1]!);
  }
  if (host.endsWith(".cache.amazonaws.com")) {
    const region = findAwsRegion(host);
    if (region) return awsLocation("AWS", "Amazon ElastiCache", kind, region);
  }
  if ((m = host.match(/\.([a-z0-9-]+)\.aws\.neon\.tech$/))) {
    return awsLocation("Neon", "Neon Postgres", kind, m[1]!);
  }
  if ((m = host.match(/\.([a-z]+)-postgres\.render\.com$/))) {
    return regionLocation("Render", "Render Postgres", kind, m[1]!, regions.render);
  }
  if (host.endsWith(".upstash.io")) return unknown("Upstash", "Upstash", kind, "Upstash hostnames don't reveal the region; check the Upstash console.");
  if (host.endsWith(".mongodb.net")) return unknown("MongoDB Atlas", "MongoDB Atlas", kind, "Atlas hostnames don't reveal the region; check the cluster configuration.");
  if (host.endsWith(".psdb.cloud")) return unknown("PlanetScale", "PlanetScale", kind);

  const region = findAwsRegion(host);
  if (region) {
    const country = awsCountry(region);
    return { provider: "AWS-hosted", service: host, kind, region, country, locationConfidence: country ? "INFERRED" : "UNKNOWN" };
  }

  const note = host.endsWith(".ng")
    ? "A .ng domain doesn't show where the server is. Declare it in residencycheck.yaml once confirmed."
    : "Location can't be inferred from the hostname.";
  return unknown("Self-hosted / other", host, kind, note);
}

export function sentryLocation(host: string): LocationBase {
  if (host.endsWith("ingest.de.sentry.io")) {
    return { provider: "Sentry", service: "Sentry", kind: "error-tracking", country: "DE", locationConfidence: "KNOWN" };
  }
  if (host.endsWith(".sentry.io") || host === "sentry.io") {
    return { provider: "Sentry", service: "Sentry", kind: "error-tracking", country: "US", locationConfidence: "KNOWN" };
  }
  return unknown("Sentry", `Sentry (self-hosted: ${host})`, "error-tracking", "Self-hosted Sentry; location depends on where you run it.");
}

export function posthogLocation(host: string): LocationBase {
  if (/^eu(\.i)?\.posthog\.com$/.test(host)) {
    return { provider: "PostHog", service: "PostHog", kind: "analytics", country: "EU", locationConfidence: "KNOWN" };
  }
  if (/^(us(\.i)?|app)\.posthog\.com$/.test(host)) {
    return { provider: "PostHog", service: "PostHog", kind: "analytics", country: "US", locationConfidence: "KNOWN" };
  }
  return unknown("PostHog", "PostHog", "analytics", `Host ${host} is probably a reverse proxy or self-hosted instance; check where it forwards.`);
}

const DATADOG_SITES: Record<string, string> = {
  "datadoghq.com": "US",
  "us3.datadoghq.com": "US",
  "us5.datadoghq.com": "US",
  "ddog-gov.com": "US",
  "datadoghq.eu": "EU",
  "ap1.datadoghq.com": "JP",
  "ap2.datadoghq.com": "AU",
};

export function datadogLocation(site: string): LocationBase {
  const s = site.toLowerCase().replace(/^https?:\/\//, "").replace(/^app\./, "");
  const country = DATADOG_SITES[s];
  return {
    provider: "Datadog", service: "Datadog", kind: "logging", region: s, country,
    locationConfidence: country ? "KNOWN" : "UNKNOWN",
  };
}
