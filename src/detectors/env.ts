import {
  classifyHost, datadogLocation, hostOf, posthogLocation, sentryLocation, awsLocation,
  type LocationBase,
} from "../hosts.js";
import type { ScanContext } from "../walk.js";
import type { Detected } from "./index.js";

const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/;

const DB_KEY = /(^|_)(DATABASE|POSTGRES|POSTGRESQL|PG|MYSQL|MONGO|MONGODB|DIRECT|DB)(_\w+)?_(URL|URI|HOST)$|^PGHOST$/;
const CACHE_KEY = /(^|_)(REDIS|KV|VALKEY|MEMCACHED?)(_\w+)?_(URL|URI|HOST)$/;
const QUEUE_KEY = /^(KAFKA_(BROKERS?|BOOTSTRAP_SERVERS)|(CLOUD)?AMQP_URL|RABBITMQ_URL)$/;

const PROCESSORS: Record<string, string> = {
  PAYSTACK: "Paystack",
  FLUTTERWAVE: "Flutterwave",
  FLW: "Flutterwave",
  MONNIFY: "Monnify",
  INTERSWITCH: "Interswitch",
  SEERBIT: "SeerBit",
  SQUAD: "Squad",
  KORAPAY: "Korapay",
  REMITA: "Remita",
  STRIPE: "Stripe",
};

const MESSAGING: Record<string, string> = {
  RESEND: "Resend",
  SENDGRID: "SendGrid",
  POSTMARK: "Postmark",
  MAILGUN: "Mailgun",
  TWILIO: "Twilio",
  TERMII: "Termii",
  BREVO: "Brevo",
  AFRICASTALKING: "Africa's Talking",
};

/** Values for these keys aren't secret, so we can show them in evidence. */
const SHOWABLE = /(REGION|SITE)$/;

export function detectEnv(ctx: ScanContext): Detected[] {
  const out: Detected[] = [];
  for (const file of ctx.files.filter((f) => ENV_FILE.test(f))) {
    ctx.read(file).split(/\r?\n/).forEach((raw, i) => {
      const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) return;
      const key = m[1]!.toUpperCase();
      const value = unquote(m[2]!);
      if (!value) return;
      const base = fromEnv(key, value);
      if (base) out.push({ ...base, evidence: [{ file, line: i + 1, snippet: describe(key, value) }] });
    });
  }
  return out;
}

function fromEnv(key: string, value: string): LocationBase | null {
  if (/SENTRY_DSN$/.test(key)) {
    const host = hostOf(value);
    return host ? sentryLocation(host) : null;
  }
  if (/POSTHOG_(API_)?HOST$/.test(key)) {
    const host = hostOf(value);
    return host ? posthogLocation(host) : null;
  }
  if (key === "DD_SITE") return datadogLocation(value);
  if (key === "DD_API_KEY" || key === "DATADOG_API_KEY") {
    return { ...datadogLocation("datadoghq.com"), locationConfidence: "INFERRED", note: "No DD_SITE found; Datadog defaults to US1." };
  }
  if (key === "AWS_REGION" || key === "AWS_DEFAULT_REGION") {
    return awsLocation("AWS", "AWS (default region)", "cloud", value);
  }
  if (/^(AWS_)?S3_\w*REGION$/.test(key)) {
    return awsLocation("AWS", "Amazon S3", "storage", value);
  }
  if (/SUPABASE_URL$/.test(key)) {
    const host = hostOf(value);
    return host ? classifyHost(host, "database") : null;
  }
  if (DB_KEY.test(key)) {
    const host = hostOf(value);
    return host ? classifyHost(host, "database") : null;
  }
  if (CACHE_KEY.test(key) || /^UPSTASH_REDIS_REST_URL$/.test(key)) {
    const host = hostOf(value);
    return host ? classifyHost(host, "cache") : null;
  }
  if (QUEUE_KEY.test(key)) {
    const host = hostOf(value.split(",")[0]!.trim()) ?? hostOf(`kafka://${value.split(",")[0]!.trim()}`);
    return host ? classifyHost(host, "queue") : null;
  }
  const prefix = key.split("_")[0]!;
  if (PROCESSORS[prefix]) {
    return { provider: PROCESSORS[prefix]!, service: PROCESSORS[prefix]!, kind: "payments", locationConfidence: "UNKNOWN" };
  }
  if (MESSAGING[prefix]) {
    return { provider: MESSAGING[prefix]!, service: MESSAGING[prefix]!, kind: "messaging", locationConfidence: "UNKNOWN" };
  }
  return null;
}

function unquote(raw: string): string {
  const v = raw.trim();
  const quoted = v.match(/^(['"])(.*)\1/);
  if (quoted) return quoted[2]!;
  return v.replace(/\s+#.*$/, "").trim();
}

/** Evidence text that never includes credentials. */
function describe(key: string, value: string): string {
  if (SHOWABLE.test(key)) return `${key}=${value}`;
  const host = hostOf(value);
  if (host) return `${key} → host ${host}`;
  return `${key} is set`;
}
