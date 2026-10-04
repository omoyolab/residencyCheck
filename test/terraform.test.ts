import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHcl } from "../src/detectors/hcl.js";
import { scan } from "../src/scan.js";

const r = scan(fileURLToPath(new URL("./fixtures/terraform", import.meta.url)));
const find = (service: string) => {
  const f = r.findings.find((x) => x.location.service === service);
  if (!f) throw new Error(`no finding for ${service}; have: ${r.findings.map((x) => x.location.service).join(", ")}`);
  return f;
};

describe("terraform: AWS", () => {
  it("prefers terraform.tfvars over the variable default", () => {
    expect(find("RDS payments")).toMatchObject({ id: "RC-DB-001", exposure: "CLEAR" });
    expect(find("RDS payments").location).toMatchObject({ region: "af-south-1", country: "ZA", locationConfidence: "KNOWN" });
  });

  it("follows provider aliases for replicas and backup replication", () => {
    expect(find("RDS payments_replica (replica)")).toMatchObject({ id: "RC-DB-003", exposure: "LIKELY" });
    expect(find("RDS payments_replica (replica)").location.region).toBe("eu-west-1");
    expect(find("RDS backup replication payments")).toMatchObject({ id: "RC-DB-002", exposure: "LIKELY" });
  });

  it("marks S3 replication destinations and DynamoDB global table replicas", () => {
    expect(find("S3 statements_dr (replica)").location.country).toBe("IE");
    expect(find("DynamoDB ledger (replica)")).toMatchObject({ id: "RC-DB-003" });
    expect(find("DynamoDB ledger (replica)").location.country).toBe("DE");
  });

  it("collapses many Lambdas into one hosting row", () => {
    expect(r.findings.filter((f) => f.location.service === "Lambda")).toHaveLength(1);
  });
});

describe("terraform: Azure", () => {
  it("resolves resource group references and display-name regions", () => {
    expect(find("Azure PostgreSQL pg").location).toMatchObject({ region: "southafricanorth", country: "ZA" });
  });

  it("infers geo-redundant copies in the paired region", () => {
    expect(find("Azure PostgreSQL pg (backup)")).toMatchObject({ id: "RC-DB-002" });
    expect(find("Azure PostgreSQL pg (backup)").location).toMatchObject({ region: "southafricawest", locationConfidence: "INFERRED" });
    expect(find("Storage account receipts (replica)").location.region).toBe("southafricawest");
  });

  it("splits Cosmos DB geo_locations into primary and replica", () => {
    expect(find("Cosmos DB events").location.country).toBe("NL");
    expect(find("Cosmos DB events (replica)").location.country).toBe("IE");
  });
});

describe("terraform: GCP", () => {
  it("uses the provider region, explicit regions and multi-regions", () => {
    expect(find("Cloud SQL main").location.country).toBe("GB");
    expect(find("Cloud SQL read (replica)").location.country).toBe("BE");
    expect(find("BigQuery analytics")).toMatchObject({ id: "RC-WH-001" });
    expect(find("BigQuery analytics").location.country).toBe("EU");
    expect(find("GCS exports").location.country).toBe("GB");
  });
});

describe("parseHcl", () => {
  it("handles heredocs, multi-line expressions, comments and one-line blocks", () => {
    const root = parseHcl(
      [
        'resource "a" "b" {',
        "  policy = <<EOT",
        "  resource \"fake\" \"inside_heredoc\" {",
        "EOT",
        "  doc = jsonencode({",
        '    x = "}"',
        "  })",
        '  region = "eu-west-1" # trailing comment',
        "  /* block",
        '  region = "us-east-1"',
        "  */",
        "  empty {}",
        "}",
        'resource "c" "d" {}',
      ].join("\n"),
      "main.tf",
    );
    expect(root.blocks.map((b) => b.labels.join("."))).toEqual(["a.b", "c.d"]);
    const b = root.blocks[0]!;
    expect(b.attrs.get("region")?.raw).toBe('"eu-west-1"');
    expect(b.blocks.map((x) => x.type)).toEqual(["empty"]);
  });
});

describe("terraform: module calls", () => {
  it("instantiates a local module once per call with the caller's provider", () => {
    expect(find("RDS ledger_db").location).toMatchObject({ region: "af-south-1", country: "ZA" });
    expect(find("RDS ledger_db_replica (replica)")).toMatchObject({ id: "RC-DB-003" });
    expect(find("RDS ledger_db_replica (replica)").location).toMatchObject({ region: "eu-west-2", country: "GB" });
  });

  it("does not emit the called module on its own with a guessed region", () => {
    expect(r.findings.some((f) => f.location.service === "RDS this")).toBe(false);
  });

  it("recognises registry modules and ignores non-data ones", () => {
    expect(find("S3 receipts").location.country).toBe("ZA");
    expect(r.findings.some((f) => f.location.service.includes("network"))).toBe(false);
  });

  it("lists unrecognised modules instead of passing them silently", () => {
    expect(r.notAnalysed).toEqual([expect.stringContaining("module.mystery")]);
  });
});
