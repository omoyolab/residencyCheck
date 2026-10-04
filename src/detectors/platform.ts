import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { classifyHost, hostOf, regionLocation } from "../hosts.js";
import { regions } from "../rules.js";
import { lineOf, type ScanContext } from "../walk.js";
import type { Detected } from "./index.js";

export function detectPlatform(ctx: ScanContext): Detected[] {
  const out: Detected[] = [];
  for (const file of ctx.files) {
    const name = file.split("/").pop()!;
    try {
      if (name === "fly.toml") out.push(...fly(ctx, file));
      else if (name === "render.yaml") out.push(...render(ctx, file));
      else if (name === "vercel.json") out.push(...vercel(ctx, file));
      else if (/(^|\/)supabase\/\.temp\/pooler-url$/.test(file)) out.push(...supabasePooler(ctx, file));
      else if (name === "railway.json" || name === "railway.toml") {
        out.push({ provider: "Railway", service: "Railway", kind: "hosting", locationConfidence: "UNKNOWN",
          evidence: [{ file, snippet: "Railway config present" }] });
      }
    } catch {
      // Malformed config: skip rather than fail the whole scan.
    }
  }
  return out;
}

function fly(ctx: ScanContext, file: string): Detected[] {
  const text = ctx.read(file);
  const region = (parseToml(text) as { primary_region?: string }).primary_region;
  if (!region) {
    return [{ provider: "Fly.io", service: "Fly.io app", kind: "hosting", locationConfidence: "UNKNOWN",
      evidence: [{ file, snippet: "no primary_region set" }] }];
  }
  return [{ ...regionLocation("Fly.io", "Fly.io app", "hosting", region, regions.fly),
    evidence: [{ file, line: lineOf(text, "primary_region"), snippet: `primary_region = "${region}"` }] }];
}

interface RenderBlueprint {
  services?: { name?: string; type?: string; region?: string }[];
  databases?: { name?: string; region?: string }[];
}

function render(ctx: ScanContext, file: string): Detected[] {
  const text = ctx.read(file);
  const doc = parseYaml(text) as RenderBlueprint;
  const out: Detected[] = [];
  const entry = (name: string | undefined, region: string | undefined, kind: "hosting" | "database", service: string): Detected => {
    const r = region ?? "oregon";
    const base = regionLocation("Render", service, kind, r, regions.render, region ? "KNOWN" : "INFERRED");
    return {
      ...base,
      note: region ? undefined : "No region set; Render defaults to Oregon.",
      evidence: [{ file, line: name ? lineOf(text, name) : undefined, snippet: `${name ?? kind}: region ${region ?? "(default)"}` }],
    };
  };
  for (const s of doc.services ?? []) {
    if (s.type === "redis" || s.type === "keyvalue") {
      out.push({ ...entry(s.name, s.region, "hosting", "Render Key Value"), kind: "cache" });
    } else {
      out.push(entry(s.name, s.region, "hosting", "Render service"));
    }
  }
  for (const d of doc.databases ?? []) out.push(entry(d.name, d.region, "database", "Render Postgres"));
  return out;
}

function vercel(ctx: ScanContext, file: string): Detected[] {
  const text = ctx.read(file);
  const regionsList = (JSON.parse(text) as { regions?: string[] }).regions;
  if (!regionsList?.length) {
    return [{ ...regionLocation("Vercel", "Vercel functions", "hosting", "iad1", regions.vercel, "INFERRED"),
      note: "No regions set; Vercel functions default to iad1 (Washington, D.C.).",
      evidence: [{ file, snippet: "vercel.json without regions" }] }];
  }
  return regionsList.map((r) => ({
    ...regionLocation("Vercel", "Vercel functions", "hosting", r, regions.vercel),
    evidence: [{ file, line: lineOf(text, `"${r}"`), snippet: `regions: ${r}` }],
  }));
}

function supabasePooler(ctx: ScanContext, file: string): Detected[] {
  const host = hostOf(ctx.read(file).trim());
  const base = host ? classifyHost(host, "database") : null;
  return base ? [{ ...base, evidence: [{ file, line: 1, snippet: `pooler host ${host}` }] }] : [];
}
