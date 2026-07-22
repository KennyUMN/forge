import { describe, it, expect } from "vitest";
import { autoAllowReadOnlyPolicy, askBeforeWriteOrBashPolicy } from "../../src/permission/permission-policies.js";

describe("autoAllowReadOnlyPolicy", () => {
  it("allows read_file", () => {
    expect(autoAllowReadOnlyPolicy.evaluate({ id: "1", name: "read_file", input: {} })).toBe("allow");
  });

  it("does not decide on bash", () => {
    expect(autoAllowReadOnlyPolicy.evaluate({ id: "1", name: "bash", input: {} })).toBeUndefined();
  });
});

describe("askBeforeWriteOrBashPolicy", () => {
  it("asks before bash", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "bash", input: {} })).toBe("ask");
  });

  it("asks before write_file", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "write_file", input: {} })).toBe("ask");
  });

  it("does not decide on read_file", () => {
    expect(askBeforeWriteOrBashPolicy.evaluate({ id: "1", name: "read_file", input: {} })).toBeUndefined();
  });
});
