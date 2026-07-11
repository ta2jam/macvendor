import type { SourceManifest } from "../types";

const RAW_LOCATOR = Symbol("macvendor.adapter.rawLocator");
const LOCATOR = /^row:[1-9][0-9]*$/;

export type RawAdapterRow = Record<string, unknown> & { [RAW_LOCATOR]?: string };

export function setRawLocator(row: RawAdapterRow, locator: string): RawAdapterRow {
  if (!LOCATOR.test(locator)) throw new Error("adapter raw locator is invalid");
  const existing = row[RAW_LOCATOR];
  if (existing === locator) return row;
  if (existing) throw new Error("adapter raw locator cannot be replaced");
  Object.defineProperty(row, RAW_LOCATOR, { value: locator, enumerable: false, writable: false, configurable: false });
  return row;
}

export function inheritRawLocator(source: RawAdapterRow, target: RawAdapterRow): RawAdapterRow {
  const locator = source[RAW_LOCATOR];
  if (!locator) throw new Error("adapter source row has no raw locator");
  return setRawLocator(target, locator);
}

export function adapterRawLocator(row: RawAdapterRow): string | null {
  return row[RAW_LOCATOR] ?? null;
}

export interface AdapterWarning {
  code: string;
}

export interface AdapterResult {
  rows: RawAdapterRow[];
  warnings: AdapterWarning[];
}

export interface SourceAdapter {
  readonly key: string;
  readonly versions: readonly string[];
  readonly sourceSlugs?: readonly string[];
  validateManifest(manifest: SourceManifest): void;
  adapt(rows: RawAdapterRow[], manifest: SourceManifest): AdapterResult;
}
