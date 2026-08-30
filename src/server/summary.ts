import type { MountedOperation } from "../openapi/types.js";

export function formatStartupSummary(
  operations: MountedOperation[],
  info: { title: string; version: string },
  address: { host: string; port: number },
): string {
  const lines: string[] = [];
  lines.push(`apiary-mock — ${info.title} (${info.version})`);
  lines.push(`listening on http://${address.host}:${address.port}`);
  lines.push("");
  lines.push(`mounted ${operations.length} operation(s):`);

  const sorted = [...operations].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  for (const op of sorted) {
    const method = op.method.toUpperCase().padEnd(7, " ");
    const id = op.operationId ? `  (${op.operationId})` : "";
    lines.push(`  ${method} ${op.path}${id}`);
  }
  return lines.join("\n");
}
