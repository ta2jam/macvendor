import { ImportValidationError } from "../errors";
import type { SourceManifest } from "../types";
import { ieeeDatasetForManifest } from "@/sources/ieee";

const HEADERS = ["Registry", "Assignment", "Organization Name", "Organization Address"];
const FORBIDDEN_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;

function normalizeIeeeText(value: string): string {
  return value.normalize("NFC").replace(FORBIDDEN_TEXT, " ").replace(/\s+/gu, " ").trim();
}

export interface IeeeAdapterWarning {
  code: "IEEE_DUPLICATE_ASSIGNMENT_OMITTED";
  assignment: string;
  sourceRows: number[];
}

export function adaptIeeeRows(rows: Array<Record<string, unknown>>, manifest: SourceManifest): {
  rows: Array<Record<string, unknown>>;
  warnings: IeeeAdapterWarning[];
} {
  const dataset = ieeeDatasetForManifest(manifest);
  if (!dataset) throw new ImportValidationError("IEEE_MANIFEST_MISMATCH", "IEEE adapter manifest is not an approved fixed dataset");
  const assignments = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    if (typeof row.Assignment === "string") {
      const indexes = assignments.get(row.Assignment) ?? [];
      indexes.push(index + 1);
      assignments.set(row.Assignment, indexes);
    }
  }
  const duplicated = new Set([...assignments].filter(([, indexes]) => indexes.length > 1).map(([assignment]) => assignment));
  const warnings = [...duplicated].sort().map((assignment) => ({
    code: "IEEE_DUPLICATE_ASSIGNMENT_OMITTED" as const,
    assignment,
    sourceRows: assignments.get(assignment)!,
  }));
  const adapted = rows.flatMap((row, index) => {
    const headers = Object.keys(row);
    if (headers.length !== HEADERS.length || HEADERS.some((header) => !headers.includes(header))) {
      throw new ImportValidationError("IEEE_SCHEMA_CHANGED", "IEEE CSV header differs from the reviewed schema");
    }
    const registry = row.Registry;
    const assignment = row.Assignment;
    const organization = row["Organization Name"];
    const address = row["Organization Address"];
    if (registry !== dataset.registry || typeof assignment !== "string"
      || !new RegExp(`^[0-9A-Fa-f]{${Math.ceil(dataset.prefixLength / 4)}}$`).test(assignment)
      || typeof organization !== "string" || typeof address !== "string") {
      throw new ImportValidationError("IEEE_RECORD_INVALID", `IEEE row ${index + 1} violates the reviewed dataset shape`);
    }
    const organizationName = normalizeIeeeText(organization);
    const organizationAddress = normalizeIeeeText(address);
    if (!organizationName) throw new ImportValidationError("IEEE_RECORD_INVALID", `IEEE row ${index + 1} has no assignee`);
    if (duplicated.has(assignment)) return [];
    const isPrivate = organizationName.toUpperCase() === "PRIVATE";
    return [{
      prefix: assignment.toUpperCase(),
      prefixLength: String(dataset.prefixLength),
      organizationName: isPrivate ? "" : organizationName,
      organizationAddress: isPrivate ? "" : organizationAddress,
      registry: dataset.registry,
      private: isPrivate ? "true" : "false",
      evidenceReference: dataset.url,
    }];
  });
  return { rows: adapted, warnings };
}
