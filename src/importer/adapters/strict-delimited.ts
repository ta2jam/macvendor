import type { RawAdapterRow, SourceAdapter } from "./types";

export const STRICT_DELIMITED_ADAPTER_KEY = "strict-delimited-v1";

export const strictDelimitedAdapter: SourceAdapter = Object.freeze({
  key: STRICT_DELIMITED_ADAPTER_KEY,
  versions: Object.freeze(["1"]),
  validateManifest: () => undefined,
  adapt: (rows: RawAdapterRow[]) => ({ rows, warnings: [] }),
});
