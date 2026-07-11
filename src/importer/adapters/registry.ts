import { ImportValidationError } from "../errors";
import type { SourceManifest } from "../types";
import { ieeeAdapter } from "./ieee";
import { strictDelimitedAdapter } from "./strict-delimited";
import {
  adapterRawLocator, setRawLocator,
  type AdapterResult, type AdapterWarning, type RawAdapterRow, type SourceAdapter,
} from "./types";

const WARNING_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const WARNING_LIMIT = 1_000;
const WARNING_BYTES = 256 * 1024;

const adapters: readonly SourceAdapter[] = Object.freeze([strictDelimitedAdapter, ieeeAdapter]);
const byKey = new Map<string, SourceAdapter>();
const sourceOwners = new Map<string, string>();
for (const adapter of adapters) {
  if (byKey.has(adapter.key)) throw new Error(`duplicate source adapter key: ${adapter.key}`);
  if (!adapter.versions.length || new Set(adapter.versions).size !== adapter.versions.length) {
    throw new Error(`source adapter ${adapter.key} must declare unique supported versions`);
  }
  byKey.set(adapter.key, adapter);
  for (const slug of adapter.sourceSlugs ?? []) {
    if (sourceOwners.has(slug)) throw new Error(`duplicate source adapter owner: ${slug}`);
    sourceOwners.set(slug, adapter.key);
  }
}

export const REGISTERED_ADAPTER_KEYS = Object.freeze([...byKey.keys()]);

export function sourceAdapter(adapterKey: string): SourceAdapter {
  const adapter = byKey.get(adapterKey);
  if (!adapter) throw new ImportValidationError("UNSUPPORTED_ADAPTER", "manifest requests an unreviewed adapter");
  return adapter;
}

export function validateAdapterManifest(manifest: SourceManifest): SourceAdapter {
  const adapter = sourceAdapter(manifest.source.adapterKey);
  const owner = sourceOwners.get(manifest.source.slug);
  if (owner && owner !== adapter.key) {
    throw new ImportValidationError(
      "ADAPTER_SOURCE_RESERVED", `${manifest.source.slug} is reserved for its reviewed source adapter`,
    );
  }
  if (!adapter.versions.includes(manifest.release.adapterVersion)) {
    throw new ImportValidationError(
      "UNSUPPORTED_ADAPTER_VERSION", `${adapter.key} does not support adapterVersion=${manifest.release.adapterVersion}`,
    );
  }
  adapter.validateManifest(manifest);
  return adapter;
}

function validateWarnings(warnings: AdapterWarning[]): void {
  if (warnings.length > WARNING_LIMIT || warnings.some((warning) => !warning || !WARNING_CODE.test(warning.code))) {
    throw new ImportValidationError("ADAPTER_WARNINGS_INVALID", "adapter warnings exceed the bounded warning contract");
  }
  let encoded: string;
  try { encoded = JSON.stringify(warnings); }
  catch { throw new ImportValidationError("ADAPTER_WARNINGS_INVALID", "adapter warnings must be JSON serializable"); }
  if (Buffer.byteLength(encoded, "utf8") > WARNING_BYTES) {
    throw new ImportValidationError("ADAPTER_WARNINGS_INVALID", "adapter warnings exceed 256 KiB");
  }
}

export function adaptSourceRows(rows: RawAdapterRow[], manifest: SourceManifest): AdapterResult {
  rows.forEach((row, index) => setRawLocator(row, `row:${index + 1}`));
  const inputLocators = new Set(rows.map((row) => adapterRawLocator(row)!));
  const result = validateAdapterManifest(manifest).adapt(rows, manifest);
  if (!result || !Array.isArray(result.rows) || !Array.isArray(result.warnings)) {
    throw new ImportValidationError("ADAPTER_RESULT_INVALID", "adapter returned an invalid result contract");
  }
  if (result.rows.length > rows.length) {
    throw new ImportValidationError("ADAPTER_EXPANSION_BLOCKED", "V1 adapters cannot expand the source row count");
  }
  const outputLocators = result.rows.map(adapterRawLocator);
  if (outputLocators.some((locator) => !locator || !inputLocators.has(locator))
    || new Set(outputLocators).size !== outputLocators.length) {
    throw new ImportValidationError(
      "ADAPTER_LOCATOR_INVALID", "adapter output must preserve unique source-row locators",
    );
  }
  validateWarnings(result.warnings);
  return result;
}
