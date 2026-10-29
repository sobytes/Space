/**
 * Where visual probes write their output.
 *
 * Resolved from this file rather than from the working directory. The probes are invoked both
 * directly and through an npm workspace script, which runs them with the working directory set
 * to `website/` while `artifacts/` sits at the repository root. A relative path works under one
 * and throws ENOENT under the other, which is the third time that pattern has bitten this repo.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Absolute path inside `artifacts/`, with the directory created. */
export function artifact(...parts) {
  const dir = join(ROOT, "artifacts", ...parts.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, parts[parts.length - 1]);
}
