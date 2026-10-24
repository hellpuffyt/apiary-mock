import type { MountedOperation } from "../openapi/types.js";

export interface RouteMatch {
  operation: MountedOperation;
  pathParams: Record<string, string>;
}

/**
 * Matches a request against the mounted operations.
 *
 * `rawPathname` must still be percent-encoded (as it arrives on the wire). Each `/`-separated
 * segment is decoded exactly once, after splitting, so an encoded slash (`%2F`) stays inside
 * its path parameter and a literal `%` (`%25`) is not decoded twice. Returns undefined when
 * nothing matches or a segment is not valid percent-encoding.
 */
export function matchRoute(
  operations: MountedOperation[],
  method: string,
  rawPathname: string,
): RouteMatch | undefined {
  const segments: string[] = [];
  for (const raw of rawPathname.split("/")) {
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return undefined;
    }
  }
  for (const op of operations) {
    if (op.method !== method.toLowerCase()) continue;
    const template = op.path.split("/");
    if (template.length !== segments.length) continue;
    const pathParams: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < template.length && ok; i++) {
      const tmpl = template[i] as string;
      const seg = segments[i] as string;
      const param = /^\{(.+)\}$/.exec(tmpl);
      if (param) {
        if (seg === "") ok = false;
        else pathParams[param[1] as string] = seg;
      } else if (tmpl !== seg) {
        ok = false;
      }
    }
    if (ok) return { operation: op, pathParams };
  }
  return undefined;
}

/** True if some operation's path template matches `pathname` for a *different* method. */
export function pathExistsForOtherMethod(operations: MountedOperation[], pathname: string): boolean {
  return operations.some((op) => op.pathRegex.test(pathname));
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[a.length]![b.length]!;
}

/** Returns up to `limit` known paths, closest-first, for a helpful 404 in --strict mode. */
export function findNearbyPaths(operations: MountedOperation[], pathname: string, limit = 3): string[] {
  const uniquePaths = [...new Set(operations.map((op) => op.path))];
  return uniquePaths
    .map((path) => ({ path, distance: levenshtein(path, pathname) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.path);
}
