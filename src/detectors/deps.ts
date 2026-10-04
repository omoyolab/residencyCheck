import { lineOf, type ScanContext } from "../walk.js";
import type { LocationBase } from "../hosts.js";
import type { Detected } from "./index.js";

interface DepRule {
  match: RegExp;
  location: LocationBase;
  /** Generic infra hint (e.g. "uses Redis"); dropped when a concrete location of the same kind is found. */
  generic?: boolean;
}

const vendorDefault = (provider: string, kind: LocationBase["kind"], country: string, note: string): LocationBase => ({
  provider, service: provider, kind, country, locationConfidence: "INFERRED", note,
});
const unknown = (provider: string, kind: LocationBase["kind"], service = provider): LocationBase => ({
  provider, service, kind, locationConfidence: "UNKNOWN",
});

const RULES: DepRule[] = [
  // Observability
  { match: /^@sentry\/|^sentry-sdk$|^github\.com\/getsentry\/sentry-go$/, location: unknown("Sentry", "error-tracking") },
  { match: /^@bugsnag\//, location: unknown("Bugsnag", "error-tracking") },
  { match: /^rollbar$/, location: unknown("Rollbar", "error-tracking") },
  { match: /^dd-trace$|^ddtrace$|^datadog(-api-client)?$|^@datadog\/|^gopkg\.in\/datadog\//i,
    location: vendorDefault("Datadog", "logging", "US", "No DD_SITE found; Datadog defaults to US1.") },
  { match: /^newrelic$/, location: unknown("New Relic", "logging") },
  { match: /^@logtail\/|^logtail-python$/, location: unknown("Better Stack", "logging") },
  { match: /^@axiomhq\//, location: unknown("Axiom", "logging") },
  // Analytics
  { match: /^posthog(-js|-node|-react-native|-python)?$/,
    location: vendorDefault("PostHog", "analytics", "US", "No PostHog host found; PostHog Cloud defaults to US.") },
  { match: /^mixpanel(-browser)?$/,
    location: vendorDefault("Mixpanel", "analytics", "US", "Mixpanel defaults to US data residency unless an EU project is configured.") },
  { match: /^@amplitude\/|^amplitude-analytics$/,
    location: vendorDefault("Amplitude", "analytics", "US", "Amplitude defaults to US unless the EU server zone is configured.") },
  { match: /^@segment\/|^(segment-)?analytics-python$/,
    location: vendorDefault("Segment", "analytics", "US", "Segment defaults to US unless an EU workspace is configured.") },
  { match: /^logrocket$/, location: unknown("LogRocket", "analytics") },
  // Datastores
  { match: /^@supabase\/supabase-js$|^supabase$/, location: unknown("Supabase", "database", "Supabase Postgres") },
  { match: /^(ioredis|redis|@upstash\/redis|@vercel\/kv)$/, location: unknown("Redis", "cache"), generic: true },
  { match: /^(bullmq|bull|kafkajs|amqplib|celery|kombu)$/, location: unknown("Message queue", "queue"), generic: true },
  { match: /^@aws-sdk\/client-sqs$/, location: unknown("AWS", "queue", "Amazon SQS") },
  { match: /^@aws-sdk\/client-s3$/, location: unknown("AWS", "storage", "Amazon S3") },
  { match: /^aws-sdk$|^boto3$|^github\.com\/aws\/aws-sdk-go(-v2)?$/, location: unknown("AWS", "cloud", "AWS (SDK)") },
  // Payment processors
  { match: /^paystack|^@paystack\/|^pypaystack/, location: unknown("Paystack", "payments") },
  { match: /^flutterwave|^rave-python$/, location: unknown("Flutterwave", "payments") },
  { match: /^monnify/, location: unknown("Monnify", "payments") },
  { match: /^@?seerbit/, location: unknown("SeerBit", "payments") },
  { match: /^korapay/, location: unknown("Korapay", "payments") },
  { match: /^stripe$/, location: unknown("Stripe", "payments") },
  // Messaging
  { match: /^resend$/, location: unknown("Resend", "messaging") },
  { match: /^@sendgrid\/|^sendgrid$/, location: unknown("SendGrid", "messaging") },
  { match: /^postmark$/, location: unknown("Postmark", "messaging") },
  { match: /^twilio$/, location: unknown("Twilio", "messaging") },
  { match: /^mailgun(\.js)?$/, location: unknown("Mailgun", "messaging") },
  { match: /^termii/, location: unknown("Termii", "messaging") },
  { match: /^africastalking$/, location: unknown("Africa's Talking", "messaging") },
];

const LINE_MANIFEST = /(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|go\.mod)$/;

export function detectDeps(ctx: ScanContext): Detected[] {
  const out: Detected[] = [];
  const add = (name: string, file: string, line: number | undefined) => {
    for (const rule of RULES) {
      if (rule.match.test(name)) {
        out.push({ ...rule.location, generic: rule.generic, evidence: [{ file, line, snippet: `dependency ${name}` }] });
        return;
      }
    }
  };

  for (const file of ctx.files) {
    if (/(^|\/)package\.json$/.test(file)) {
      const text = ctx.read(file);
      let pkg: { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
      try {
        pkg = JSON.parse(text);
      } catch {
        continue;
      }
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
        add(name, file, lineOf(text, `"${name}"`));
      }
    } else if (LINE_MANIFEST.test(file)) {
      // One heuristic covers requirements.txt, Pipfile, poetry/PEP 621 pyproject and go.mod lines.
      ctx.read(file).split(/\r?\n/).forEach((line, i) => {
        const name = line.match(/^\s*(?:require\s+)?"?([A-Za-z0-9_.\-/@]+)/)?.[1];
        if (name) add(name.toLowerCase(), file, i + 1);
      });
    }
  }
  return out;
}
