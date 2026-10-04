import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { PaymentRelevance } from "./types.js";

const load = (name: string): unknown =>
  parse(readFileSync(new URL(`../rules/${name}`, import.meta.url), "utf8"));

type RegionMap = Record<string, string>;

export const regions = load("regions.yaml") as {
  aws: RegionMap;
  awsLocalZones: RegionMap;
  gcp: RegionMap;
  azure: RegionMap;
  render: RegionMap;
  fly: RegionMap;
  vercel: RegionMap;
  countries: RegionMap;
};

export const paymentRules = load("payment-data.yaml") as {
  tables: Record<Exclude<PaymentRelevance, "LOW">, string[]>;
  columns: Record<Exclude<PaymentRelevance, "LOW">, string[]> & {
    money: string[];
    moneySuffixes: string[];
    moneyCompanions: string[];
  };
};

export function awsCountry(region: string): string | undefined {
  for (const [prefix, country] of Object.entries(regions.awsLocalZones)) {
    if (region.startsWith(prefix)) return country;
  }
  return regions.aws[region];
}

export function countryName(code: string | undefined): string {
  if (!code) return "location unknown";
  return regions.countries[code] ?? code;
}

export const NIGERIA = "NG";
