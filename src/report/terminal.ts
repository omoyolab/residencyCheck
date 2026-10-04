import pc from "picocolors";
import { CITATION } from "../findings.js";
import { countryName } from "../rules.js";
import type { Exposure, Finding, Location, ScanResult } from "../types.js";

const WIDTH = 88;

const EXPOSURE_STYLE: Record<Exposure, { symbol: string; color: (s: string) => string }> = {
  CLEAR: { symbol: "✗", color: (s) => pc.red(pc.bold(s)) },
  LIKELY: { symbol: "✗", color: pc.yellow },
  UNCLEAR: { symbol: "?", color: pc.cyan },
  VERIFY: { symbol: "·", color: pc.magenta },
  INFO: { symbol: "·", color: pc.dim },
};

export function destination(loc: Location): string {
  if (loc.kind === "payments") return "third-party processor";
  if (!loc.country) return "location unknown";
  return [loc.region, countryName(loc.country)].filter(Boolean).join(" · ");
}

export function renderTerminal(result: ScanResult): string {
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  line(pc.bold(`ResidencyCheck v${result.tool.version}`) + pc.dim(` — ${CITATION}`));
  line(pc.dim(`Scanned ${result.scannedFiles} files in ${result.root}`));
  line();

  line(pc.bold("Payment data detected"));
  const payment = result.datasets.filter((d) => d.relevance !== "LOW");
  if (!payment.length) {
    line(pc.dim("  none found (checked Prisma, SQL migrations and Drizzle schemas)"));
  }
  const nameWidth = Math.max(20, ...payment.map((d) => d.name.length));
  for (const d of payment) {
    const where = `${d.evidence.file}${d.evidence.line ? `:${d.evidence.line}` : ""}`;
    const rel = d.relevance === "HIGH" ? pc.red(d.relevance.padEnd(7)) : pc.yellow(d.relevance.padEnd(7));
    line(`  ${d.name.padEnd(nameWidth)}  ${rel} ${pc.dim(where)}`);
  }
  line();

  line(pc.bold("Where it goes"));
  if (!result.findings.length) line(pc.dim("  no external services detected"));
  const serviceWidth = Math.max(20, ...result.findings.map((f) => f.location.service.length));
  const destWidth = Math.max(20, ...result.findings.map((f) => destination(f.location).length));
  for (const f of result.findings) {
    const s = EXPOSURE_STYLE[f.exposure];
    line(`  ${s.color(s.symbol)} ${f.location.service.padEnd(serviceWidth)}  ${destination(f.location).padEnd(destWidth)}  ${s.color(f.exposure.padEnd(8))} ${pc.dim(f.id)}`);
  }
  line();

  const detailed = result.findings.filter((f) => f.exposure === "CLEAR" || f.exposure === "LIKELY" || f.exposure === "UNCLEAR");
  if (detailed.length) {
    line(pc.bold("Findings"));
    for (const f of detailed) renderFinding(f, line);
  }

  const verify = result.findings.filter((f) => f.exposure === "VERIFY");
  if (verify.length) {
    line(pc.bold("Requires third-party confirmation"));
    line(`  ${verify.map((f) => f.location.provider).join(", ")}`);
    line(pc.dim(wrap("ResidencyCheck does not assert where processors store data. Ask each for written confirmation of their CBN localisation status.", 2)));
    line();
  }

  if (result.notAnalysed.length) {
    line(pc.bold("Not analysed"));
    for (const n of result.notAnalysed) line(wrap(`- ${n}`, 2, 4));
    line();
  }

  line(pc.bold("Exposure summary"));
  const { CLEAR, LIKELY, UNCLEAR, VERIFY, INFO } = result.summary;
  line(`  ${EXPOSURE_STYLE.CLEAR.color(`${CLEAR} CLEAR`)}`);
  line(`  ${EXPOSURE_STYLE.LIKELY.color(`${LIKELY} LIKELY`)}`);
  line(`  ${EXPOSURE_STYLE.UNCLEAR.color(`${UNCLEAR} UNCLEAR`)}`);
  line(`  ${EXPOSURE_STYLE.VERIFY.color(`${VERIFY} REQUIRE THIRD-PARTY CONFIRMATION`)}`);
  if (INFO) line(`  ${pc.dim(`${INFO} configured in Nigeria`)}`);
  line();

  line(pc.dim(wrap("This is an exposure inventory based on project configuration, not a compliance determination. " +
    "Configuration shows what was intended, not what is deployed. The circular does not define backups, logs or processing abroad.", 0)));
  line(pc.dim("Details for any rule: residencycheck explain <RULE-ID>"));
  return out.join("\n");
}

function renderFinding(f: Finding, line: (s?: string) => void) {
  const s = EXPOSURE_STYLE[f.exposure];
  const ev = f.location.evidence[0];
  const evText = ev ? `${ev.file}${ev.line ? `:${ev.line}` : ""}  ${ev.snippet}` : "";
  const more = f.location.evidence.length > 1 ? pc.dim(` (+${f.location.evidence.length - 1} more)`) : "";

  line(`  ${s.color(f.id)}  ${pc.bold(f.title)}`);
  field("Destination", `${f.location.service} · ${destination(f.location)}`);
  field("Location confidence", `${f.location.locationConfidence}${evText ? pc.dim(` — ${evText}`) : ""}${more}`);
  if (f.location.note) field("", pc.dim(f.location.note));
  const tables = f.datasets.length ? pc.dim(` — ${f.datasets.map((d) => d.name).join(", ")}`) : "";
  field("Payment relevance", `${f.paymentRelevance}${tables}`);
  field("Regulatory exposure", s.color(f.exposure));
  line(pc.dim(wrap(`Why ${f.exposure} (our reading): ${f.why}`, 4)));
  if (f.exposure !== "UNCLEAR") {
    for (const r of f.remediation) line(wrap(`- ${r}`, 4, 6));
  }
  line();

  function field(label: string, value: string) {
    line(`    ${pc.dim(label.padEnd(20))}  ${value}`);
  }
}

export function wrap(text: string, indent: number, hanging = indent): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = " ".repeat(indent);
  for (const w of words) {
    if (current.trim() && current.length + w.length + 1 > WIDTH) {
      lines.push(current);
      current = " ".repeat(hanging) + w;
    } else {
      current += (current.trim() ? " " : "") + w;
    }
  }
  if (current.trim()) lines.push(current);
  return lines.join("\n");
}
