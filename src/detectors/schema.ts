import { paymentRules } from "../rules.js";
import type { ScanContext } from "../walk.js";
import type { Dataset, PaymentRelevance } from "../types.js";

const RANK: Record<PaymentRelevance, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const SQL_NON_COLUMNS = new Set(["CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "INDEX", "KEY", "EXCLUDE"]);
const DRIZZLE_PATH = /(schema|db|models?|drizzle)/i;

export function detectSchema(ctx: ScanContext): Dataset[] {
  const found: Dataset[] = [];
  for (const file of ctx.files) {
    if (file.endsWith(".prisma")) found.push(...prisma(ctx.read(file), file));
    else if (file.endsWith(".sql")) found.push(...sql(ctx.read(file), file));
    else if (/\.(ts|js|mjs)$/.test(file) && DRIZZLE_PATH.test(file)) found.push(...drizzle(ctx.read(file), file));
  }

  // Same table defined in several places (schema + migrations): keep the highest relevance.
  const byName = new Map<string, Dataset>();
  for (const d of found) {
    const prev = byName.get(d.name);
    if (!prev || RANK[d.relevance] > RANK[prev.relevance]) byName.set(d.name, d);
  }
  return [...byName.values()].sort((a, b) => RANK[b.relevance] - RANK[a.relevance] || a.name.localeCompare(b.name));
}

export function snake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function classify(table: string, columns: string[]): { relevance: PaymentRelevance; signals: string[] } {
  const t = snake(table);
  const cols = columns.map(snake);
  const tableMatches = (p: string) => t === p || t.startsWith(p) || t.includes(`_${p}`);
  const colsMatching = (p: string) => cols.filter((c) => c === p || c.startsWith(`${p}_`) || c.endsWith(`_${p}`));

  let relevance: PaymentRelevance = "LOW";
  const signals: string[] = [];
  const raise = (to: PaymentRelevance) => { if (RANK[to] > RANK[relevance]) relevance = to; };

  if (paymentRules.tables.HIGH.some(tableMatches)) raise("HIGH");
  else if (paymentRules.tables.MEDIUM.some(tableMatches)) raise("MEDIUM");

  for (const p of paymentRules.columns.HIGH) {
    const hits = colsMatching(p);
    if (hits.length) { raise("HIGH"); signals.push(...hits); }
  }
  const amount = colsMatching("amount");
  const companions = paymentRules.columns.amountCompanions.flatMap(colsMatching);
  if (amount.length && companions.length) { raise("HIGH"); signals.push(...amount, ...companions); }
  for (const p of paymentRules.columns.MEDIUM) {
    const hits = colsMatching(p);
    if (hits.length) { raise("MEDIUM"); signals.push(...hits); }
  }
  return { relevance, signals: [...new Set(signals)] };
}

function dataset(name: string, columns: string[], file: string, line: number, kind: string): Dataset {
  const { relevance, signals } = classify(name, columns);
  return { name: snake(name), relevance, signals, evidence: { file, line, snippet: `${kind} ${name}` } };
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

function prisma(text: string, file: string): Dataset[] {
  const out: Dataset[] = [];
  for (const m of text.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
    const body = m[2]!;
    const mapped = body.match(/@@map\(\s*["'](\w+)["']\s*\)/)?.[1];
    const columns = body.split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => l.split(/\s+/)[0]!)
      .filter((c) => /^\w+$/.test(c));
    out.push(dataset(mapped ?? m[1]!, columns, file, lineAt(text, m.index!), "model"));
  }
  return out;
}

function sql(text: string, file: string): Dataset[] {
  const out: Dataset[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([`"\[\]\w.]+)\s*\(([\s\S]*?)\)\s*;/gi;
  for (const m of text.matchAll(re)) {
    const name = m[1]!.split(".").pop()!.replace(/[`"\[\]]/g, "");
    out.push(dataset(name, sqlColumns(m[2]!), file, lineAt(text, m.index!), "table"));
  }
  return out;
}

function sqlColumns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; } else current += ch;
  }
  parts.push(current);
  return parts
    .map((p) => p.replace(/--.*$/gm, "").trim().split(/\s+/)[0]?.replace(/[`"\[\]]/g, "") ?? "")
    .filter((c) => c && !SQL_NON_COLUMNS.has(c.toUpperCase()));
}

function drizzle(text: string, file: string): Dataset[] {
  const out: Dataset[] = [];
  for (const m of text.matchAll(/(?:pg|mysql|sqlite)Table\(\s*["'`](\w+)["'`]\s*,\s*\{([\s\S]*?)\n\s*\}/g)) {
    const columns = [...m[2]!.matchAll(/^\s*(\w+)\s*:/gm)].map((c) => c[1]!);
    out.push(dataset(m[1]!, columns, file, lineAt(text, m.index!), "table"));
  }
  return out;
}
