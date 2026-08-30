import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("applies defaults when no flags are given", () => {
    const options = parseArgs([]);
    expect(options.port).toBe(4010);
    expect(options.host).toBe("127.0.0.1");
    expect(options.strict).toBe(false);
    expect(options.delay).toBe(0);
    expect(options.failRate).toBe(0);
    expect(options.seed).toBe("apiary-mock");
  });

  it("parses --spec and --scenarios", () => {
    const options = parseArgs(["--spec", "a.yaml", "--scenarios", "b.yaml"]);
    expect(options.spec).toBe("a.yaml");
    expect(options.scenarios).toBe("b.yaml");
  });

  it("parses numeric flags", () => {
    const options = parseArgs(["--port", "8080", "--delay", "100", "--fail-rate", "0.5", "--prefer", "404"]);
    expect(options.port).toBe(8080);
    expect(options.delay).toBe(100);
    expect(options.failRate).toBe(0.5);
    expect(options.prefer).toBe(404);
  });

  it("parses the --strict flag", () => {
    expect(parseArgs(["--strict"]).strict).toBe(true);
  });

  it("parses --seed", () => {
    expect(parseArgs(["--seed", "my-seed"]).seed).toBe("my-seed");
  });

  it("parses --help / -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("throws on an unknown flag", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
  });
});
