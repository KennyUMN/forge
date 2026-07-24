import { describe, it, expect } from "vitest";
import { boundOutput, boundOutputBytes } from "../../src/tool/output-bounds.js";

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("boundOutput", () => {
  it("passes short output through unchanged", () => {
    const output = lines(50);
    expect(boundOutput(output)).toBe(output);
  });

  it("passes output at exactly maxLines through unchanged", () => {
    const output = lines(200);
    expect(boundOutput(output)).toBe(output);
  });

  it("truncates output exceeding maxLines with head+tail and elision marker", () => {
    const output = lines(300);
    const result = boundOutput(output);
    const resultLines = result.split("\n");

    expect(resultLines[0]).toBe("line 1");
    expect(resultLines[79]).toBe("line 80");
    expect(result).toContain("…[180 lines elided]…");
    expect(resultLines[resultLines.length - 1]).toBe("line 300");
    expect(resultLines[resultLines.length - 40]).toBe("line 261");
  });

  it("respects custom options", () => {
    const output = lines(100);
    const result = boundOutput(output, { maxLines: 50, headLines: 20, tailLines: 10 });
    const resultLines = result.split("\n");

    expect(resultLines[0]).toBe("line 1");
    expect(resultLines[19]).toBe("line 20");
    expect(result).toContain("…[70 lines elided]…");
    expect(resultLines[resultLines.length - 1]).toBe("line 100");
    expect(resultLines[resultLines.length - 10]).toBe("line 91");
  });

  it("handles output with exactly maxLines + 1 lines", () => {
    const output = lines(201);
    const result = boundOutput(output);
    expect(result).toContain("…[81 lines elided]…");
  });

  it("does not mutate the input string", () => {
    const output = lines(300);
    const original = output;
    boundOutput(output);
    expect(output).toBe(original);
  });
});

describe("boundOutputBytes", () => {
  it("passes small output through unchanged", () => {
    const output = "hello world";
    expect(boundOutputBytes(output)).toBe(output);
  });

  it("truncates output exceeding maxBytes with head+tail", () => {
    const output = "x".repeat(200_000);
    const result = boundOutputBytes(output, { maxBytes: 100_000 });
    const byteLength = Buffer.byteLength(result, "utf-8");
    expect(byteLength).toBeLessThanOrEqual(100_000 + 100);
    expect(result).toContain("elided");
  });

  it("applies line bounding after byte truncation", () => {
    const output = lines(5000);
    const result = boundOutputBytes(output, { maxBytes: 50_000 });
    expect(result).toContain("elided");
  });

  it("respects custom maxBytes", () => {
    const output = "a".repeat(10_000);
    const result = boundOutputBytes(output, { maxBytes: 1_000 });
    const byteLength = Buffer.byteLength(result, "utf-8");
    expect(byteLength).toBeLessThanOrEqual(1_100);
  });
});
