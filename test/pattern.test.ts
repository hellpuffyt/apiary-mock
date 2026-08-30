import { describe, expect, it } from "vitest";
import { generateFromPattern } from "../src/generation/pattern.js";
import { createRng } from "../src/generation/rng.js";

describe("generateFromPattern", () => {
  it("generates digits for \\d+", () => {
    const rng = createRng("d1");
    const value = generateFromPattern("^\\d+$", rng);
    expect(value).toMatch(/^\d+$/);
  });

  it("generates a fixed-length alphabetic code", () => {
    const rng = createRng("d2");
    const value = generateFromPattern("^[A-Z]{5}$", rng);
    expect(value).toMatch(/^[A-Z]{5}$/);
  });

  it("respects alternation", () => {
    for (let i = 0; i < 10; i++) {
      const value = generateFromPattern("^(cat|dog|fish)$", createRng(`alt${i}`));
      expect(["cat", "dog", "fish"]).toContain(value);
    }
  });

  it("respects character class ranges and negation", () => {
    const rng = createRng("d4");
    const value = generateFromPattern("^[^0-9]{6}$", rng);
    expect(value).toMatch(/^[^0-9]{6}$/);
  });

  it("supports optional groups with ?", () => {
    for (let i = 0; i < 10; i++) {
      const value = generateFromPattern("^ab?c$", createRng(`opt${i}`));
      expect(["ac", "abc"]).toContain(value);
    }
  });

  it("never throws on malformed input, falling back to a literal-ish string", () => {
    expect(() => generateFromPattern("(unclosed", createRng("bad"))).not.toThrow();
  });

  it("is deterministic for a fixed seed", () => {
    const a = generateFromPattern("^[a-z]{8}$", createRng("stable"));
    const b = generateFromPattern("^[a-z]{8}$", createRng("stable"));
    expect(a).toBe(b);
  });
});
