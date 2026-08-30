import type { MountedOperation, OpenApiResponse } from "../openapi/types.js";
import { generateValue } from "../generation/generator.js";
import type { Rng } from "../generation/rng.js";

export interface SelectedResponse {
  status: number;
  contentType?: string;
  body: unknown;
  headers: Record<string, string>;
}

function statusToNumber(status: string): number | undefined {
  if (/^\d+$/.test(status)) return Number(status);
  return undefined;
}

/** Picks which declared response to serve: --prefer if present and valid, else lowest 2xx, else first. */
export function selectResponseEntry(
  op: MountedOperation,
  preferStatus?: number,
): { status: string; response: OpenApiResponse } {
  const entries = Object.entries(op.operation.responses);
  if (entries.length === 0) {
    throw new Error(`Operation ${op.method.toUpperCase()} ${op.path} declares no responses`);
  }

  if (preferStatus !== undefined) {
    const match = entries.find(([status]) => statusToNumber(status) === preferStatus);
    if (match) return { status: match[0], response: match[1] };
  }

  const twoXx = entries
    .filter(([status]) => {
      const n = statusToNumber(status);
      return n !== undefined && n >= 200 && n < 300;
    })
    .sort((a, b) => (statusToNumber(a[0]) ?? 0) - (statusToNumber(b[0]) ?? 0));
  if (twoXx.length > 0) {
    const [status, response] = twoXx[0] as [string, OpenApiResponse];
    return { status, response };
  }

  const [status, response] = entries[0] as [string, OpenApiResponse];
  return { status, response };
}

export function buildResponse(
  op: MountedOperation,
  preferStatus: number | undefined,
  rng: Rng,
): SelectedResponse {
  const { status, response } = selectResponseEntry(op, preferStatus);
  const statusNum = statusToNumber(status) ?? 200;

  const headers: Record<string, string> = {};
  if (response.headers) {
    for (const [name, def] of Object.entries(response.headers)) {
      headers[name] = String(generateValue(def.schema, { rng }));
    }
  }

  if (!response.content) {
    return { status: statusNum, body: undefined, headers };
  }

  const contentType = Object.keys(response.content)[0];
  if (!contentType) return { status: statusNum, body: undefined, headers };

  const media = response.content[contentType];
  let body: unknown;
  if (media?.example !== undefined) {
    body = media.example;
  } else if (media?.examples) {
    const values = Object.values(media.examples);
    body = values[0]?.value;
  } else {
    body = generateValue(media?.schema, { rng });
  }

  return { status: statusNum, contentType, body, headers };
}
