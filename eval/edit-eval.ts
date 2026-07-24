export interface EditEvalCase {
  name: string;
  originalFile: string;
  instruction: string;
  expectedContains: string[];
  expectedNotContains?: string[];
}

export function scoreEditResult(result: string, evalCase: EditEvalCase): { passed: boolean; score: number } {
  let checks = 0;
  let passedChecks = 0;

  for (const expected of evalCase.expectedContains) {
    checks++;
    if (result.includes(expected)) passedChecks++;
  }

  for (const notExpected of evalCase.expectedNotContains ?? []) {
    checks++;
    if (!result.includes(notExpected)) passedChecks++;
  }

  const score = checks === 0 ? 1 : passedChecks / checks;
  return { passed: score === 1, score };
}

export const EDIT_EVAL_CASES: EditEvalCase[] = [
  {
    name: "rename a variable",
    originalFile: `function greet(name) {\n  return "Hello, " + name;\n}\n`,
    instruction: "Rename the parameter 'name' to 'userName'",
    expectedContains: ["userName", `"Hello, " + userName`],
    expectedNotContains: ["name)"],
  },
  {
    name: "add a function",
    originalFile: `export function add(a, b) {\n  return a + b;\n}\n`,
    instruction: "Add a subtract function after the add function",
    expectedContains: ["export function add(a, b)", "function subtract", "return a - b"],
  },
  {
    name: "fix an off-by-one bug",
    originalFile: `function sumRange(start, end) {\n  let total = 0;\n  for (let i = start; i < end; i++) {\n    total += i;\n  }\n  return total;\n}\n`,
    instruction: "Fix the loop so it includes the end value (inclusive range)",
    expectedContains: ["i <= end"],
    expectedNotContains: ["i < end"],
  },
  {
    name: "add error handling",
    originalFile: `function parseConfig(raw) {\n  return JSON.parse(raw);\n}\n`,
    instruction: "Wrap JSON.parse in a try/catch that returns null on failure",
    expectedContains: ["try", "catch", "JSON.parse(raw)", "return null"],
  },
  {
    name: "change return type",
    originalFile: `function divide(a, b) {\n  return a / b;\n}\n`,
    instruction: "Return an object { result, remainder } using Math.floor and modulo instead of a plain division",
    expectedContains: ["Math.floor", "%", "result", "remainder"],
    expectedNotContains: ["return a / b"],
  },
  {
    name: "add a parameter with default",
    originalFile: `function createUser(name, email) {\n  return { name, email, role: "user" };\n}\n`,
    instruction: "Add an optional 'role' parameter with default value 'viewer'",
    expectedContains: ['role = "viewer"', "return { name, email, role }"],
    expectedNotContains: ['role: "user"'],
  },
  {
    name: "replace console.log with a logger",
    originalFile: `function process(data) {\n  console.log("processing", data);\n  const result = data.map(x => x * 2);\n  console.log("done", result);\n  return result;\n}\n`,
    instruction: "Replace console.log calls with logger.info calls",
    expectedContains: ["logger.info"],
    expectedNotContains: ["console.log"],
  },
  {
    name: "add TypeScript types",
    originalFile: `function multiply(a, b) {\n  return a * b;\n}\n`,
    instruction: "Add TypeScript type annotations: parameters are numbers, return type is number",
    expectedContains: ["a: number", "b: number", "): number"],
  },
  {
    name: "extract a constant",
    originalFile: `function celsiusToFahrenheit(c) {\n  return c * 9 / 5 + 32;\n}\n`,
    instruction: "Extract the magic numbers into named constants FREEZING_POINT and RATIO",
    expectedContains: ["FREEZING_POINT", "RATIO", "32", "9", "5"],
    expectedNotContains: ["c * 9 / 5 + 32"],
  },
  {
    name: "add input validation",
    originalFile: `function getElement(arr, index) {\n  return arr[index];\n}\n`,
    instruction: "Add a bounds check that throws a RangeError if index is out of bounds",
    expectedContains: ["RangeError", "index", "arr.length"],
  },
];
