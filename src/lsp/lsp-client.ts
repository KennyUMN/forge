export interface LspLocation {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface SymbolInfo {
  name: string;
  kind: string;
  range: LspLocation["range"];
}

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  range: LspLocation["range"];
}

export interface LspClient {
  initialize(rootPath: string): Promise<void>;
  openDocument(filePath: string, content: string): Promise<void>;
  closeDocument(filePath: string): Promise<void>;
  definition(filePath: string, line: number, character: number): Promise<LspLocation[]>;
  references(filePath: string, line: number, character: number): Promise<LspLocation[]>;
  hover(filePath: string, line: number, character: number): Promise<string | null>;
  documentSymbols(filePath: string): Promise<SymbolInfo[]>;
  diagnostics(filePath: string): Promise<Diagnostic[]>;
  shutdown(): Promise<void>;
}
