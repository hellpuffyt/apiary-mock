import type { Rng } from "./rng.js";

/**
 * A small best-effort generator for JSON Schema `pattern` regexes.
 *
 * It supports the common subset used in real specs: literals, `.`, character classes
 * (including negation and ranges), the `\d \w \s \D \W \S` shorthands, groups, alternation
 * `|`, and quantifiers `* + ? {n} {n,} {n,m}`. Anchors `^`/`$` are treated as no-ops since we
 * only ever generate a full-string match. Constructs beyond this subset (lookaround,
 * backreferences) fall back to a literal-ish rendering of the pattern's fixed characters so
 * generation never throws — callers should treat pattern support as "feasible effort", not a
 * guarantee, per the spec.
 */

type Node =
  | { kind: "literal"; value: string }
  | { kind: "charClass"; negate: boolean; ranges: Array<[string, string]>; chars: string[] }
  | { kind: "any" }
  | { kind: "group"; alternatives: Node[][] }
  | { kind: "repeat"; node: Node; min: number; max: number };

const DIGIT: Array<[string, string]> = [["0", "9"]];
const WORD_RANGES: Array<[string, string]> = [
  ["a", "z"],
  ["A", "Z"],
  ["0", "9"],
];
const WORD_CHARS: string[] = ["_"];
const SPACE_CHARS: string[] = [" ", "\t", "\n"];

class PatternParser {
  private pos = 0;
  constructor(private src: string) {}

  parse(): Node[][] {
    const alternatives = this.parseAlternatives();
    return alternatives;
  }

  private parseAlternatives(): Node[][] {
    const branches: Node[][] = [this.parseSequence()];
    while (this.peek() === "|") {
      this.pos++;
      branches.push(this.parseSequence());
    }
    return branches;
  }

  private parseSequence(): Node[] {
    const nodes: Node[] = [];
    while (this.pos < this.src.length && this.peek() !== "|" && this.peek() !== ")") {
      nodes.push(this.parseQuantified());
    }
    return nodes;
  }

  private parseQuantified(): Node {
    const atom = this.parseAtom();
    const c = this.peek();
    if (c === "*") {
      this.pos++;
      return { kind: "repeat", node: atom, min: 0, max: 5 };
    }
    if (c === "+") {
      this.pos++;
      return { kind: "repeat", node: atom, min: 1, max: 5 };
    }
    if (c === "?") {
      this.pos++;
      return { kind: "repeat", node: atom, min: 0, max: 1 };
    }
    if (c === "{") {
      const close = this.src.indexOf("}", this.pos);
      if (close !== -1) {
        const body = this.src.slice(this.pos + 1, close);
        const m = /^(\d+)(,(\d*))?$/.exec(body);
        if (m) {
          this.pos = close + 1;
          const min = Number(m[1]);
          const max = m[2] === undefined ? min : m[3] ? Number(m[3]) : min + 5;
          return { kind: "repeat", node: atom, min, max: Math.max(min, max) };
        }
      }
    }
    return atom;
  }

  private parseAtom(): Node {
    const c = this.peek();
    if (c === "^" || c === "$") {
      this.pos++;
      return { kind: "literal", value: "" };
    }
    if (c === ".") {
      this.pos++;
      return { kind: "any" };
    }
    if (c === "(") {
      this.pos++;
      if (this.src.startsWith("?:", this.pos)) this.pos += 2;
      const alternatives = this.parseAlternatives();
      if (this.peek() === ")") this.pos++;
      return { kind: "group", alternatives };
    }
    if (c === "[") {
      return this.parseCharClass();
    }
    if (c === "\\") {
      this.pos++;
      const esc = this.src[this.pos];
      this.pos++;
      return this.shorthandNode(esc ?? "");
    }
    this.pos++;
    return { kind: "literal", value: c ?? "" };
  }

  private shorthandNode(esc: string): Node {
    switch (esc) {
      case "d":
        return { kind: "charClass", negate: false, ranges: DIGIT, chars: [] };
      case "D":
        return { kind: "charClass", negate: true, ranges: DIGIT, chars: [] };
      case "w":
        return { kind: "charClass", negate: false, ranges: WORD_RANGES, chars: WORD_CHARS };
      case "W":
        return { kind: "charClass", negate: true, ranges: WORD_RANGES, chars: WORD_CHARS };
      case "s":
        return { kind: "charClass", negate: false, ranges: [], chars: SPACE_CHARS };
      case "S":
        return { kind: "charClass", negate: true, ranges: [], chars: SPACE_CHARS };
      default:
        return { kind: "literal", value: esc };
    }
  }

  private parseCharClass(): Node {
    this.pos++; // consume [
    let negate = false;
    if (this.peek() === "^") {
      negate = true;
      this.pos++;
    }
    const ranges: Array<[string, string]> = [];
    const chars: string[] = [];
    while (this.pos < this.src.length && this.peek() !== "]") {
      const ch = this.src[this.pos] as string;
      if (ch === "\\") {
        this.pos++;
        const esc = this.src[this.pos] as string;
        this.pos++;
        const node = this.shorthandNode(esc) as Extract<Node, { kind: "charClass" }>;
        if (node.kind === "charClass" && !node.negate) {
          ranges.push(...node.ranges);
          chars.push(...node.chars);
        } else {
          chars.push(esc);
        }
        continue;
      }
      this.pos++;
      if (this.src[this.pos] === "-" && this.src[this.pos + 1] !== "]" && this.pos + 1 < this.src.length) {
        const end = this.src[this.pos + 1] as string;
        ranges.push([ch, end]);
        this.pos += 2;
      } else {
        chars.push(ch);
      }
    }
    if (this.peek() === "]") this.pos++;
    return { kind: "charClass", negate, ranges, chars };
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }
}

const PRINTABLE_ASCII: string[] = [];
for (let i = 33; i < 127; i++) PRINTABLE_ASCII.push(String.fromCharCode(i));

function classToPool(node: Extract<Node, { kind: "charClass" }>): string[] {
  const pool = new Set<string>();
  for (const [start, end] of node.ranges) {
    const s = start.charCodeAt(0);
    const e = end.charCodeAt(0);
    for (let code = s; code <= e; code++) pool.add(String.fromCharCode(code));
  }
  for (const c of node.chars) pool.add(c);
  if (node.negate) {
    return PRINTABLE_ASCII.filter((c) => !pool.has(c));
  }
  return [...pool];
}

function generateNode(node: Node, rng: Rng): string {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "any": {
      const idx = Math.floor(rng() * PRINTABLE_ASCII.length);
      return PRINTABLE_ASCII[idx] as string;
    }
    case "charClass": {
      const pool = classToPool(node);
      if (pool.length === 0) return "x";
      const idx = Math.floor(rng() * pool.length);
      return pool[idx] as string;
    }
    case "group": {
      const idx = Math.floor(rng() * node.alternatives.length);
      const branch = node.alternatives[idx] as Node[];
      return branch.map((n) => generateNode(n, rng)).join("");
    }
    case "repeat": {
      const count = node.min + Math.floor(rng() * (node.max - node.min + 1));
      let out = "";
      for (let i = 0; i < count; i++) out += generateNode(node.node, rng);
      return out;
    }
  }
}

/** Best-effort: generates a string that satisfies `pattern`. Never throws. */
export function generateFromPattern(pattern: string, rng: Rng): string {
  try {
    const parser = new PatternParser(pattern);
    const alternatives = parser.parse();
    const idx = Math.floor(rng() * alternatives.length);
    const branch = alternatives[idx] as Node[];
    return branch.map((n) => generateNode(n, rng)).join("");
  } catch {
    return "generated";
  }
}
