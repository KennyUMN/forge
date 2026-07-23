import { describe, it, expect } from "vitest";
import { CliUsageError, HELP_TEXT, parseCliArgs } from "../../src/cli/args.js";

describe("parseCliArgs", () => {
  it("defaults to the interactive run command with no options", () => {
    expect(parseCliArgs([])).toEqual({ command: "run" });
  });

  it("recognises help and version in either form", () => {
    for (const flag of ["-h", "--help"]) expect(parseCliArgs([flag]).command).toBe("help");
    for (const flag of ["-v", "--version"]) expect(parseCliArgs([flag]).command).toBe("version");
  });

  // Help and version short-circuit so that "forge --model x --help" explains
  // itself rather than trying to start a session with a half-parsed config.
  it("returns help even when other options precede it", () => {
    expect(parseCliArgs(["--model", "x", "--help"])).toEqual({ command: "help" });
  });

  it("parses the update and config subcommands", () => {
    expect(parseCliArgs(["update"]).command).toBe("update");
    expect(parseCliArgs(["config"]).command).toBe("config");
  });

  // Otherwise "forge -p 'run the update script'" would be read as the update
  // subcommand the moment the word appeared anywhere in the arguments.
  it("only treats a subcommand as one in first position", () => {
    const options = parseCliArgs(["-p", "update"]);

    expect(options.command).toBe("run");
    expect(options.prompt).toBe("update");
  });

  it("parses every value-taking option in both long and short form", () => {
    const options = parseCliArgs([
      "-m",
      "ComboOP",
      "--provider",
      "openai-compatible",
      "--base-url",
      "https://9router.home/v1",
      "--api-key-env",
      "NINEROUTER_API_KEY",
      "-c",
      "/tmp/work",
      "-r",
      "abc-123",
      "--ca-cert",
      "/tmp/ca.crt",
    ]);

    expect(options).toEqual({
      command: "run",
      model: "ComboOP",
      providerType: "openai-compatible",
      baseUrl: "https://9router.home/v1",
      apiKeyEnv: "NINEROUTER_API_KEY",
      cwd: "/tmp/work",
      resumeSessionId: "abc-123",
      caCertPath: "/tmp/ca.crt",
    });
  });

  it("parses the boolean flags", () => {
    const options = parseCliArgs(["--continue", "--yes", "--insecure"]);

    expect(options.continueLatest).toBe(true);
    expect(options.autoApprove).toBe(true);
    expect(options.insecure).toBe(true);
  });

  it("rejects an unknown provider type by name, listing the valid ones", () => {
    expect(() => parseCliArgs(["--provider", "ollama"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["--provider", "ollama"])).toThrow(/openai-compatible/);
  });

  it("rejects an unknown option rather than ignoring it", () => {
    expect(() => parseCliArgs(["--wat"])).toThrow(/Unknown option "--wat"/);
  });

  // Without this, "forge --model --resume abc" silently sets the model to
  // "--resume" and starts a session against a model that does not exist.
  it("rejects a value-taking option followed by another flag instead of a value", () => {
    expect(() => parseCliArgs(["--model", "--resume", "abc"])).toThrow(/--model requires a value/);
  });

  it("rejects a value-taking option at the end of the arguments", () => {
    expect(() => parseCliArgs(["--base-url"])).toThrow(/--base-url requires a value/);
  });

  it("rejects --resume and --continue together, since they name different sessions", () => {
    expect(() => parseCliArgs(["--resume", "abc", "--continue"])).toThrow(/cannot be used together/);
  });

  it("documents every option it accepts", () => {
    for (const flag of [
      "--model",
      "--provider",
      "--base-url",
      "--api-key-env",
      "--cwd",
      "--resume",
      "--continue",
      "--print",
      "--yes",
      "--ca-cert",
      "--insecure",
      "--help",
      "--version",
    ]) {
      expect(HELP_TEXT).toContain(flag);
    }
  });
});
