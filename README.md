# Forge

An agentic coding CLI, written in TypeScript from scratch after studying ten
open-source coding agents.

Forge is a kernel first and a CLI second. The agent loop, session store,
permission gate, tool registry and provider abstraction are a headless library
with no terminal concerns in them; the CLI is one consumer of that library and
holds no privileges the library does not expose.

**Status: early.** The kernel works and is well covered by tests. It is not a
replacement for a mature agent CLI, and it is being built in the open.

## Install

Requires Node 20 or newer.

```sh
git clone https://github.com/KennyUMN/forge.git
cd forge
npm install
npm run build
npm link          # puts `forge` on your PATH
```

`forge update` fast-forwards the clone and rebuilds it in place.

## Configure

Settings resolve in three layers, each winning over the one before it:

1. `~/.forge/forge.config.json` — your defaults
2. `./forge.config.json` — per-project overrides
3. command-line flags

Provider fields merge individually, so a repository can pin a model without
restating the endpoint and key variable it inherits.

**API keys are never read from config files.** `apiKeyEnv` names an environment
variable; Forge loads `~/.forge/.env` and `./.env` at startup, so a key can
live in `~/.forge/.env` and stay out of every repository.

### Anthropic

```json
{ "provider": { "type": "anthropic", "model": "claude-sonnet-4-5" } }
```

```sh
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> ~/.forge/.env
```

### OpenRouter

```json
{ "provider": { "type": "openrouter", "model": "anthropic/claude-3.5-sonnet" } }
```

### Any OpenAI-compatible endpoint

Ollama, LM Studio, vLLM, LiteLLM, a self-hosted router, or any vendor speaking
the chat-completions dialect:

```json
{
  "provider": {
    "type": "openai-compatible",
    "name": "ollama",
    "baseUrl": "http://localhost:11434/v1",
    "model": "qwen2.5-coder",
    "contextWindow": 32768
  }
}
```

`apiKeyEnv` is optional — omit it for local runtimes that do not authenticate.
For an endpoint behind a private certificate authority, `caCertPath` adds one
trust anchor; `insecureSkipTlsVerify` (or `--insecure`) skips verification for
that provider's connections only, never for anything else the process does.

`contextWindow` is the denominator for the usage meter. Forge has no model
catalogue, so it is configured rather than guessed.

### MCP servers

```json
{
  "mcpServers": [
    { "name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
  ]
}
```

Their tools are namespaced `<server>__<tool>` when loaded, so a server exposing
`read_file` does not collide with the built-in one.

## Use

```sh
forge                                  # interactive
forge -p "explain src/agent/turn-orchestrator.ts"   # one turn, then exit
forge --continue                       # resume the most recent session
forge config                           # show the resolved configuration
forge update                           # pull and rebuild
```

| Flag | |
|---|---|
| `-m, --model <id>` | model to use |
| `--provider <type>` | `anthropic` \| `openrouter` \| `openai-compatible` |
| `--base-url <url>` | endpoint for openai-compatible providers |
| `--api-key-env <NAME>` | environment variable holding the key |
| `-c, --cwd <dir>` | working directory for tools |
| `-r, --resume <id>` | resume a specific session |
| `--continue` | resume the most recent session |
| `-p, --print <prompt>` | non-interactive: one turn, then exit |
| `--yes` | auto-approve every tool call |
| `--ca-cert <path>` | trust an extra CA |
| `--insecure` | skip TLS verification for this provider |
| `--tui` / `--no-tui` | force the full-screen UI on or off |

`FORGE_HOME` overrides `~/.forge`.

### In the terminal UI

| | |
|---|---|
| `shift+tab` | cycle permission mode |
| `ctrl-c` | interrupt the running turn, or quit when idle |
| `?` | shortcuts (when the prompt is empty) |
| `/exit` | quit |

The UI is used when stdin and stdout are both a terminal, and a line-based
prompt otherwise — so piping works:

```sh
echo "summarise this repo" | forge --no-tui --yes
```

## Permission modes

Every tool call passes through an ordered chain of policies. The mode selects
the chain.

| Mode | Reads | File writes | Shell | Unknown tools |
|---|---|---|---|---|
| `ask` | allow | ask | ask | ask |
| `accept-edits` | allow | allow | ask | ask |
| `auto` | allow | allow | allow | allow |

`accept-edits` allows writes but still asks before `bash`, because an edit is
reversible — it is on disk, visible to git, undoable — and a shell command is
not. Unknown tools, which is every MCP tool, are asked about in both supervised
modes rather than allowed.

Two guards sit outside the modes. A tool called three times with identical
arguments forces a prompt whatever the policy says, and a response truncated
mid-arguments fails its tool calls instead of executing arguments nobody can
vouch for.

## Built-in tools

`read_file` · `write_file` · `edit_file` · `bash` · `grep` · `glob`

On Windows, `bash` resolves Git for Windows' bundled shell, so the model writes
one command dialect on every platform. Paths are always reported with forward
slashes, since the model feeds them back into glob patterns.

## Architecture

```
src/
  agent/       turn orchestrator, step executor, tool dispatcher, doom-loop guard
  provider/    ModelProvider interface, Anthropic and OpenAI-compatible
  permission/  gate and policy chain
  session/     crash-tolerant JSONL log, session store
  tool/        tool contract and registry
  tools/       the built-in tools
  mcp/         MCP client
  cli/         argument parsing, config, entrypoint
  tui/         terminal UI
```

Two properties the design holds onto:

**A turn is observable.** `runTurn` emits a `TurnEvent` stream — step
boundaries, text and reasoning deltas, tool calls, tool results — so a renderer
never has to guess what happened. The UI is a consumer of that stream and
nothing more.

**Sessions are a DAG, not a list.** Every entry carries a `parentId`, and the
log is append-only and torn-line tolerant: a session killed mid-write loses its
last entry, not the file. Nothing is destroyed, which leaves fork, rewind and
non-destructive context management open as later work.

## Develop

```sh
npm test              # vitest
npm run typecheck     # source
npm run typecheck:test
npm run build
```

Docs live in `docs/`: [PRD](docs/PRD.md), [roadmap](docs/ROADMAP.md), and the
design specs and per-sprint implementation plans under `docs/superpowers/`.
