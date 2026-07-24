import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import type { LspClient, LspLocation, SymbolInfo, Diagnostic } from "./lsp-client.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: unknown;
}

const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: "File", 2: "Module", 3: "Namespace", 4: "Package", 5: "Class",
  6: "Method", 7: "Property", 8: "Field", 9: "Constructor", 10: "Enum",
  11: "Interface", 12: "Function", 13: "Variable", 14: "Constant",
  15: "String", 16: "Number", 17: "Boolean", 18: "Array", 19: "Object",
  20: "Key", 21: "Null", 22: "EnumMember", 23: "Struct", 24: "Event",
  25: "Operator", 26: "TypeParameter",
};

const DIAGNOSTIC_SEVERITY: Record<number, Diagnostic["severity"]> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "info",
};

export function createTypeScriptLsp(): LspClient {
  let process: ChildProcess | null = null;
  let nextId = 1;
  let initialized = false;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const diagnosticsStore = new Map<string, Diagnostic[]>();
  let buffer = Buffer.alloc(0);

  function encodeMessage(msg: JsonRpcRequest | Record<string, unknown>): Buffer {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    return Buffer.from(header + body, "utf-8");
  }

  function send(msg: JsonRpcRequest | Record<string, unknown>): void {
    if (!process?.stdin?.writable) throw new Error("LSP process is not running");
    process.stdin.write(encodeMessage(msg));
  }

  function sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send(request);
    });
  }

  function sendNotification(method: string, params?: unknown): void {
    send({ jsonrpc: "2.0", method, params } as unknown as Record<string, unknown>);
  }

  function handleResponse(msg: JsonRpcResponse): void {
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri: string; diagnostics: Array<{ severity?: number; message: string; range: LspLocation["range"] }> };
      const filePath = fileURLToPath(params.uri);
      const diags: Diagnostic[] = params.diagnostics.map((d) => ({
        severity: DIAGNOSTIC_SEVERITY[d.severity ?? 3] ?? "info",
        message: d.message,
        range: d.range,
      }));
      diagnosticsStore.set(filePath, diags);
      return;
    }

    if (msg.id === null || msg.id === undefined) return;

    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);

    if (msg.error) {
      entry.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      entry.resolve(msg.result);
    }
  }

  function processBuffer(): void {
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const headerStr = buffer.subarray(0, headerEnd).toString("utf-8");
      const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + contentLength) break;

      const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf-8");
      buffer = buffer.subarray(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcResponse;
        handleResponse(msg);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  function toUri(filePath: string): string {
    return pathToFileURL(filePath).href;
  }

  function toLocation(raw: { uri: string; range: LspLocation["range"] }): LspLocation {
    return { uri: raw.uri, range: raw.range };
  }

  return {
    async initialize(rootPath: string): Promise<void> {
      if (initialized) return;

      process = spawn("typescript-language-server", ["--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      process.on("error", (err) => {
        for (const [, entry] of pending) {
          entry.reject(new Error(`LSP process error: ${err.message}. Is typescript-language-server installed?`));
        }
        pending.clear();
      });

      process.stdout?.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        processBuffer();
      });

      process.stderr?.on("data", () => {
        // Discard stderr — LSP servers log there but we don't need it
      });

      await sendRequest("initialize", {
        processId: globalThis.process.pid,
        rootUri: toUri(rootPath),
        capabilities: {
          textDocument: {
            definition: { linkSupport: false },
            references: {},
            hover: { contentFormat: ["plaintext"] },
            documentSymbol: { hierarchicalDocumentSymbolSupport: false },
            publishDiagnostics: {},
            synchronization: { didSave: true },
          },
        },
        initializationOptions: {
          preferences: { includeInlayParameterNameHints: "none" },
        },
      });

      sendNotification("initialized", {});
      initialized = true;
    },

    async openDocument(filePath: string, content: string): Promise<void> {
      sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: toUri(filePath),
          languageId: "typescript",
          version: 1,
          text: content,
        },
      });
    },

    async closeDocument(filePath: string): Promise<void> {
      sendNotification("textDocument/didClose", {
        textDocument: { uri: toUri(filePath) },
      });
      diagnosticsStore.delete(filePath);
    },

    async definition(filePath: string, line: number, character: number): Promise<LspLocation[]> {
      const result = await sendRequest("textDocument/definition", {
        textDocument: { uri: toUri(filePath) },
        position: { line, character },
      });
      if (!result) return [];
      if (Array.isArray(result)) return (result as Array<{ uri: string; range: LspLocation["range"] }>).map(toLocation);
      const single = result as { uri: string; range: LspLocation["range"] };
      return [toLocation(single)];
    },

    async references(filePath: string, line: number, character: number): Promise<LspLocation[]> {
      const result = await sendRequest("textDocument/references", {
        textDocument: { uri: toUri(filePath) },
        position: { line, character },
        context: { includeDeclaration: true },
      });
      if (!result || !Array.isArray(result)) return [];
      return (result as Array<{ uri: string; range: LspLocation["range"] }>).map(toLocation);
    },

    async hover(filePath: string, line: number, character: number): Promise<string | null> {
      const result = await sendRequest("textDocument/hover", {
        textDocument: { uri: toUri(filePath) },
        position: { line, character },
      }) as { contents: unknown } | null;
      if (!result?.contents) return null;
      const contents = result.contents;
      if (typeof contents === "string") return contents;
      if (Array.isArray(contents)) return contents.map((c) => (typeof c === "string" ? c : (c as { value: string }).value)).join("\n");
      return (contents as { value: string }).value ?? null;
    },

    async documentSymbols(filePath: string): Promise<SymbolInfo[]> {
      const result = await sendRequest("textDocument/documentSymbol", {
        textDocument: { uri: toUri(filePath) },
      });
      if (!result || !Array.isArray(result)) return [];
      return (result as Array<{ name: string; kind: number; range: LspLocation["range"] }>).map((s) => ({
        name: s.name,
        kind: SYMBOL_KIND_NAMES[s.kind] ?? `Unknown(${s.kind})`,
        range: s.range,
      }));
    },

    async diagnostics(filePath: string): Promise<Diagnostic[]> {
      return diagnosticsStore.get(filePath) ?? [];
    },

    async shutdown(): Promise<void> {
      if (!process) return;
      try {
        await sendRequest("shutdown");
        sendNotification("exit");
      } catch {
        // Process may already be dead
      }
      process.kill();
      process = null;
      initialized = false;
      pending.clear();
      diagnosticsStore.clear();
    },
  };
}
