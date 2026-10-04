import { NIGERIA } from "./rules.js";
import type { Dataset, Exposure, Finding, Location, PaymentRelevance } from "./types.js";

export const CITATION = "CBN Circular PSS/DIR/PUB/CIR/001/004 ¶2";

export const CIRCULAR_TEXT =
  "All Financial Institutions and participants facilitating payments within Nigeria shall ensure that " +
  "payments transaction data generated within Nigeria are stored and managed in Nigeria in accordance with " +
  "data protection laws and regulations applicable in Nigeria. Accordingly, all affected Financial " +
  "Institutions shall fully comply with this requirement effective January 1, 2027.";

export interface Rule {
  id: string;
  exposure: Exposure;
  title: string;
  why: string;
  remediation: string[];
}

const SILENT = "¶2 requires payment transaction data to be stored and managed in Nigeria but does not specifically address";

export const RULES: Record<string, Rule> = {
  "RC-DB-001": {
    id: "RC-DB-001", exposure: "CLEAR",
    title: "Payments database hosted outside Nigeria",
    why: "This database appears to hold payment transaction records and is configured outside Nigeria. Primary storage is the most direct reading of \"stored ... in Nigeria\".",
    remediation: [
      "Migrate the database (or the payment tables) to infrastructure located in Nigeria.",
      "If application logic stays abroad, consider a split architecture with the payment data layer in Nigeria.",
      "Record the migration plan and date as evidence of remediation.",
    ],
  },
  "RC-DB-004": {
    id: "RC-DB-004", exposure: "UNCLEAR",
    title: "Database outside Nigeria (no payment tables detected)",
    why: "No payment tables were found by the schema scan. If this database does store payment transaction data, treat this as CLEAR.",
    remediation: ["Confirm whether this database stores payment transaction data.", "If it does, plan its migration to Nigeria."],
  },
  "RC-ST-001": {
    id: "RC-ST-001", exposure: "LIKELY",
    title: "Object storage outside Nigeria in a project with payment data",
    why: "Object storage often holds exports, statements, receipts and backups. If any contain payment transaction data, that data is stored outside Nigeria.",
    remediation: ["Inventory what this bucket stores.", "Move payment-related objects to storage located in Nigeria, or stop writing them there."],
  },
  "RC-ST-002": {
    id: "RC-ST-002", exposure: "UNCLEAR",
    title: "Object storage outside Nigeria",
    why: "No payment tables were detected in this project, so we can't tell whether this storage holds payment data.",
    remediation: ["Confirm whether this storage holds payment transaction data."],
  },
  "RC-OBS-001": {
    id: "RC-OBS-001", exposure: "UNCLEAR",
    title: "Error tracker outside Nigeria",
    why: `${SILENT} error-monitoring services. Error events routinely capture request bodies, user context and stack variables, which can include payment data.`,
    remediation: [
      "Scrub payment fields (account numbers, references, amounts, card data) before events leave the app (e.g. Sentry beforeSend, sendDefaultPii: false).",
      "Or use a region / self-hosted instance in Nigeria.",
    ],
  },
  "RC-OBS-002": {
    id: "RC-OBS-002", exposure: "UNCLEAR",
    title: "Logging / APM outside Nigeria",
    why: `${SILENT} logs or application monitoring. Logs and traces often contain payment payloads and identifiers.`,
    remediation: ["Redact payment fields at the logger before shipping.", "Or keep payment-service logs in Nigeria."],
  },
  "RC-AN-001": {
    id: "RC-AN-001", exposure: "UNCLEAR",
    title: "Product analytics outside Nigeria",
    why: `${SILENT} analytics. Analytics events sometimes carry amounts, references or customer identifiers.`,
    remediation: ["Audit tracked events and properties for payment data.", "Strip or hash payment fields before sending."],
  },
  "RC-Q-001": {
    id: "RC-Q-001", exposure: "UNCLEAR",
    title: "Queue or cache outside Nigeria",
    why: `${SILENT} caches or queues. These often hold payment payloads transiently (jobs, sessions, idempotency keys).`,
    remediation: ["Check what payment data passes through it and how long it persists.", "Prefer an instance located in Nigeria for payment workloads."],
  },
  "RC-MSG-001": {
    id: "RC-MSG-001", exposure: "UNCLEAR",
    title: "Email / SMS provider outside Nigeria or location unknown",
    why: `${SILENT} messaging providers. Receipts and transaction alerts sent through them contain payment details.`,
    remediation: ["Check whether receipts or transaction alerts go through this provider.", "Ask the provider where message content is stored and for how long."],
  },
  "RC-APP-001": {
    id: "RC-APP-001", exposure: "UNCLEAR",
    title: "Application hosting outside Nigeria",
    why: `${SILENT} where payment data is processed in transit. Industry is asking CBN to clarify split-cloud setups where compute is abroad and data is local.`,
    remediation: ["Ensure the app persists no payment data locally (disk, local caches) abroad.", "Track CBN guidance on processing abroad."],
  },
  "RC-UNK-001": {
    id: "RC-UNK-001", exposure: "UNCLEAR",
    title: "Service location can't be determined",
    why: "We couldn't determine where this service is located from the project configuration. Unknown is not a pass.",
    remediation: ["Confirm the location and declare it in residencycheck.yaml (coming in v0.2)."],
  },
  "RC-3P-001": {
    id: "RC-3P-001", exposure: "VERIFY",
    title: "Third-party payment processor — confirmation required",
    why: "This processor holds payment transaction data on your behalf. Only they can confirm where it is stored. ResidencyCheck does not assert their location.",
    remediation: ["Request written confirmation of their CBN localisation status.", "Keep it with your compliance records."],
  },
  "RC-NG-001": {
    id: "RC-NG-001", exposure: "INFO",
    title: "Configured in Nigeria",
    why: "Project configuration places this service in Nigeria. This reflects configuration, not verified deployment.",
    remediation: [],
  },
};

const RANK: Record<PaymentRelevance, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
export const EXPOSURE_ORDER: Exposure[] = ["CLEAR", "LIKELY", "UNCLEAR", "VERIFY", "INFO"];

function maxRelevance(datasets: Dataset[]): PaymentRelevance {
  return datasets.reduce<PaymentRelevance>((m, d) => (RANK[d.relevance] > RANK[m] ? d.relevance : m), "LOW");
}

function ruleFor(loc: Location, hasHigh: boolean): string {
  if (loc.kind === "payments") return "RC-3P-001";
  if (loc.country === NIGERIA) return "RC-NG-001";
  if (loc.kind === "messaging") return "RC-MSG-001";
  if (!loc.country) return "RC-UNK-001";
  switch (loc.kind) {
    case "database": return hasHigh ? "RC-DB-001" : "RC-DB-004";
    case "storage": return hasHigh ? "RC-ST-001" : "RC-ST-002";
    case "error-tracking": return "RC-OBS-001";
    case "logging": return "RC-OBS-002";
    case "analytics": return "RC-AN-001";
    case "cache":
    case "queue": return "RC-Q-001";
    default: return "RC-APP-001";
  }
}

export function buildFindings(locations: Location[], datasets: Dataset[]): Finding[] {
  const paymentData = datasets.filter((d) => d.relevance !== "LOW");
  const hasHigh = paymentData.some((d) => d.relevance === "HIGH");
  const projectRelevance = maxRelevance(paymentData);
  const databases = locations.filter((l) => l.kind === "database").length;

  const findings = locations.map((loc): Finding => {
    const rule = RULES[ruleFor(loc, hasHigh)]!;
    const holdsData = loc.kind === "database";
    let why = rule.why;
    if (holdsData && databases > 1 && paymentData.length) {
      why += " Several databases were found and we can't tell which holds which tables, so payment tables are attached to each.";
    }
    return {
      id: rule.id,
      title: rule.title,
      exposure: rule.exposure,
      // v0.1 can't trace which service touches which table, so relevance is project-wide.
      paymentRelevance: projectRelevance,
      location: loc,
      datasets: holdsData ? paymentData : [],
      why,
      remediation: rule.remediation,
      citation: CITATION,
    };
  });

  return findings.sort(
    (a, b) =>
      EXPOSURE_ORDER.indexOf(a.exposure) - EXPOSURE_ORDER.indexOf(b.exposure) ||
      RANK[b.paymentRelevance] - RANK[a.paymentRelevance] ||
      a.location.service.localeCompare(b.location.service),
  );
}
