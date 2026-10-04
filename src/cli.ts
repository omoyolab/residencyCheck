#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import pc from "picocolors";
import { CIRCULAR_TEXT, CITATION, RULES } from "./findings.js";
import { renderTerminal, wrap } from "./report/terminal.js";
import { scan } from "./scan.js";
import type { ScanResult } from "./types.js";
import { VERSION } from "./version.js";

const HELP = `residencycheck v${VERSION}
Know where your payment data lives before CBN asks.

Usage
  residencycheck [scan] [path]       Scan a project (default: current directory)
  residencycheck explain <RULE-ID>   Explain a rule and show the circular text

Options
  --json                Print machine-readable JSON
  --fail-on <level>     Exit 1 when findings at or above this level exist:
                        clear | likely (default) | unclear | none
  -h, --help            Show help
  -v, --version         Show version

Runs entirely locally. No network calls, no telemetry.`;

const FAIL_ON = ["clear", "likely", "unclear", "none"] as const;
type FailOn = (typeof FAIL_ON)[number];

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      "fail-on": { type: "string", default: "likely" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return print(HELP, 0);
  if (values.version) return print(VERSION, 0);

  const [first, ...rest] = positionals;
  if (first === "explain") return explain(rest[0]);

  const failOn = values["fail-on"] as FailOn;
  if (!FAIL_ON.includes(failOn)) return error(`--fail-on must be one of: ${FAIL_ON.join(", ")}`);

  const path = (first === "scan" ? rest[0] : first) ?? ".";
  if (!existsSync(path) || !statSync(path).isDirectory()) return error(`Not a directory: ${path}`);

  const result = scan(path);
  console.log(values.json ? JSON.stringify(result, null, 2) : renderTerminal(result));
  return exitCode(result, failOn);
}

function exitCode(result: ScanResult, failOn: FailOn): number {
  const { CLEAR, LIKELY, UNCLEAR } = result.summary;
  switch (failOn) {
    case "clear": return CLEAR ? 1 : 0;
    case "likely": return CLEAR + LIKELY ? 1 : 0;
    case "unclear": return CLEAR + LIKELY + UNCLEAR ? 1 : 0;
    case "none": return 0;
  }
}

function explain(id: string | undefined): number {
  const rule = id ? RULES[id.toUpperCase()] : undefined;
  if (!rule) return error(`Unknown rule${id ? ` "${id}"` : ""}. Known rules: ${Object.keys(RULES).join(", ")}`);
  const out = [
    `${pc.bold(rule.id)}  ${rule.title}`,
    `Regulatory exposure: ${rule.exposure}`,
    "",
    pc.bold("Why (our reading, not CBN's)"),
    wrap(rule.why, 2),
    "",
  ];
  if (rule.remediation.length) out.push(pc.bold("What to do"), ...rule.remediation.map((r) => wrap(`- ${r}`, 2, 4)), "");
  out.push(pc.bold(CITATION), pc.dim(wrap(`"${CIRCULAR_TEXT}"`, 2)));
  return print(out.join("\n"), 0);
}

function print(text: string, code: number): number {
  console.log(text);
  return code;
}

function error(message: string): number {
  console.error(pc.red(`error: ${message}`));
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.exitCode = error(err instanceof Error ? err.message : String(err));
}
