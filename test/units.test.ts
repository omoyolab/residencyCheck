import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classify } from "../src/detectors/schema.js";
import { classifyHost, datadogLocation, posthogLocation, sentryLocation } from "../src/hosts.js";

describe("classifyHost", () => {
  it.each([
    ["aws-0-eu-west-2.pooler.supabase.com", "Supabase", "GB"],
    ["mydb.c9akciq32.us-east-1.rds.amazonaws.com", "AWS", "US"],
    ["ep-cool-123.eu-central-1.aws.neon.tech", "Neon", "DE"],
    ["dpg-abc-a.frankfurt-postgres.render.com", "Render", "DE"],
    ["x.af-south-1-los-1a.example.com", "AWS-hosted", "NG"],
  ])("%s → %s in %s", (host, provider, country) => {
    expect(classifyHost(host, "database")).toMatchObject({ provider, country });
  });

  it("returns null for local development hosts", () => {
    for (const h of ["localhost", "127.0.0.1", "postgres", "host.docker.internal"]) {
      expect(classifyHost(h, "database")).toBeNull();
    }
  });

  it("marks hosts it can't place as UNKNOWN", () => {
    expect(classifyHost("abcd.supabase.co", "database")).toMatchObject({ locationConfidence: "UNKNOWN" });
    expect(classifyHost("db.example.com", "database")).toMatchObject({ locationConfidence: "UNKNOWN" });
  });
});

describe("vendor hosts", () => {
  it("maps Sentry ingest hosts", () => {
    expect(sentryLocation("o1.ingest.us.sentry.io").country).toBe("US");
    expect(sentryLocation("o1.ingest.de.sentry.io").country).toBe("DE");
    expect(sentryLocation("sentry.mycorp.ng").locationConfidence).toBe("UNKNOWN");
  });

  it("maps PostHog and Datadog", () => {
    expect(posthogLocation("eu.i.posthog.com").country).toBe("EU");
    expect(posthogLocation("t.mycorp.com").locationConfidence).toBe("UNKNOWN");
    expect(datadogLocation("datadoghq.eu").country).toBe("EU");
    expect(datadogLocation("us5.datadoghq.com").country).toBe("US");
  });
});

describe("classify", () => {
  it.each([
    ["payments", [], "HIGH"],
    ["failed_payments", [], "HIGH"],
    ["LedgerEntry", [], "HIGH"],
    ["merchants", ["amount", "currency"], "HIGH"],
    ["merchants", ["bank_account_number"], "HIGH"],
    ["merchants", ["masked_pan"], "HIGH"],
    ["users", ["bvn"], "MEDIUM"],
    ["wallets", [], "MEDIUM"],
    ["merchants", ["amount"], "MEDIUM"],
    ["posts", ["title", "standard", "company"], "LOW"],
    ["discharges", [], "LOW"],
  ])("%s %j → %s", (table, cols, level) => {
    expect(classify(table, cols as string[]).relevance).toBe(level);
  });
});

describe("zero network", () => {
  it("source never imports network modules or calls fetch", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(src);
    expect(files.length).toBeGreaterThan(5);
    const banned = /from\s+["'](node:)?(http|https|http2|net|tls|dgram|dns|child_process)["']|\bfetch\s*\(|XMLHttpRequest|WebSocket/;
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(banned);
  });
});
