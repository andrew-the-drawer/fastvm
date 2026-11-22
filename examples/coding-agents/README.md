# Coding-agent sandboxes

Disposable coding-agent environments built from `node:26-slim`. Each example
installs its CLI on first boot and keeps the sandbox awake.

```sh
# OpenAI Codex
export OPENAI_API_KEY=...
fastvmctl run -f examples/coding-agents/codex.fvmfile -it

# Anthropic Claude Code
export ANTHROPIC_API_KEY=...
fastvmctl run -f examples/coding-agents/claude.fvmfile -it

# GitHub Copilot CLI
export GITHUB_TOKEN=...
fastvmctl run -f examples/coding-agents/copilot.fvmfile -it
```

Mount a project directory with `-v` or add `volumes` to the fvmfile:

```sh
fastvmctl run -f examples/coding-agents/codex.fvmfile \
  -v "$PWD:/workspace" -w /workspace -it
```

The `allow_hosts` entries cover CLI installation and API access. Add hosts if
your agent or tools require more.
