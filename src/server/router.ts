import type { MountedOperation } from "../openapi/types.js";

export interface RouteMatch {
  operation: MountedOperation;
  pathParams: Record<string, string>;
}

export function matchRoute(
  operations: MountedOperation[],
  method: string,
  pathname: string,
): RouteMatch | undefined {
  for (const op of operations) {
    if (op.method !== method.toLowerCase()) continue;
    const match = op.pathRegex.exec(pathname);
    if (!match) continue;
    const pathParams: Record<string, string> = {};
    op.pathParamNames.forEach((name, i) => {
      pathParams[name] = decodeURIComponent(match[i + 1] ?? "");
    });
    return { operation: op, pathParams };
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
