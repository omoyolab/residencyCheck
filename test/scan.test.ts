import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import type { Finding, ScanResult } from "../src/types.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const byService = (r: ScanResult, service: string): Finding | undefined =>
  r.findings.find((f) => f.location.service === service);

describe("supabase-sentry fixture", () => {
  const r = scan(fixture("supabase-sentry"));

  it("classifies payment tables", () => {
    const levels = Object.fromEntries(r.datasets.map((d) => [d.name, d.relevance]));
    expect(levels).toMatchObject({ transactions: "HIGH", webhook_event: "HIGH", user: "MEDIUM", post: "LOW" });
  });

  it("flags the Supabase database as CLEAR using the pooler region", () => {
    const db = byService(r, "Supabase Postgres")!;
    expect(db.id).toBe("RC-DB-001");
    expect(db.exposure).toBe("CLEAR");
    expect(db.location).toMatchObject({ region: "eu-west-2", country: "GB", locationConfidence: "KNOWN" });
    expect(db.datasets.map((d) => d.name)).toContain("transactions");
    // SUPABASE_URL, the pooler URL and the SDK dependency collapse into one location
    expect(r.findings.filter((f) => f.location.provider === "Supabase")).toHaveLength(1);
  });

  it("keeps the three axes separate for observability", () => {
    const sentry = byService(r, "Sentry")!;
    expect(sentry).toMatchObject({ id: "RC-OBS-001", exposure: "UNCLEAR", paymentRelevance: "HIGH" });
    expect(sentry.location).toMatchObject({ country: "US", locationConfidence: "KNOWN" });
  });

  it("prefers the configured PostHog host over the vendor default", () => {
    expect(byService(r, "PostHog")!.location).toMatchObject({ country: "EU", locationConfidence: "KNOWN" });
  });

  it("treats processors as VERIFY with no asserted country", () => {
    const paystack = byService(r, "Paystack")!;
    expect(paystack.exposure).toBe("VERIFY");
    expect(paystack.location.country).toBeUndefined();
  });

  it("reports unknown locations instead of passing them", () => {
    expect(byService(r, "Upstash")).toMatchObject({ id: "RC-UNK-001", exposure: "UNCLEAR" });
    // generic "uses Redis" hint is dropped once Upstash is known
    expect(r.findings.some((f) => f.location.provider === "Redis")).toBe(false);
  });

  it("never leaks credentials into evidence", () => {
    const json = JSON.stringify(r);
    expect(json).not.toContain("secretpw");
    expect(json).not.toContain("sk_test_placeholder");
    expect(json).not.toContain("publickey@");
  });
});

describe("render-django fixture", () => {
  const r = scan(fixture("render-django"));

  it("reads SQL migrations", () => {
    const settlements = r.datasets.find((d) => d.name === "settlements")!;
    expect(settlements.relevance).toBe("HIGH");
    expect(settlements.signals).toContain("account_number");
    expect(r.datasets.find((d) => d.name === "notes")!.relevance).toBe("LOW");
  });

  it("uses Render's default region as INFERRED", () => {
    expect(byService(r, "Render Postgres")!.location).toMatchObject({ country: "US", locationConfidence: "INFERRED" });
    expect(byService(r, "Render service")!.location).toMatchObject({ country: "DE", locationConfidence: "KNOWN" });
  });

  it("uses DD_SITE and the Sentry DE ingest host", () => {
    expect(byService(r, "Datadog")!.location).toMatchObject({ country: "EU", locationConfidence: "KNOWN" });
    expect(byService(r, "Sentry")!.location.country).toBe("DE");
  });

  it("detects Python processors", () => {
    expect(byService(r, "Flutterwave")!.exposure).toBe("VERIFY");
  });
});

describe("lagos-hosted fixture", () => {
  const r = scan(fixture("lagos-hosted"));

  it("does not trust a .ng hostname as proof of location", () => {
    const db = r.findings.find((f) => f.location.kind === "database")!;
    expect(db).toMatchObject({ id: "RC-UNK-001", exposure: "UNCLEAR" });
    expect(db.location.note).toMatch(/\.ng domain/);
  });

  it("ignores localhost services", () => {
    expect(r.findings.some((f) => f.location.kind === "cache")).toBe(false);
  });

  it("reports no payment relevance when no schema is found", () => {
    expect(r.findings.every((f) => f.paymentRelevance === "LOW")).toBe(true);
  });
});

describe("schema-only fixture", () => {
  const r = scan(fixture("schema-only"));

  it("never reads as all-clear when payment tables have no known database", () => {
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ id: "RC-UNK-002", exposure: "UNCLEAR", paymentRelevance: "HIGH" });
    expect(r.summary.UNCLEAR).toBe(1);
  });
});
