# FASTVMCTL-COMPLETION(1)

## NAME

fastvmctl-completion - generate shell completion

## SYNOPSIS

```text
fastvmctl completion bash
fastvmctl completion zsh
fastvmctl completion fish
fastvmctl completion powershell
```

## DESCRIPTION

Generates a completion script for the requested shell.

## EXAMPLES

```sh
source <(fastvmctl completion bash)
fastvmctl completion zsh > "${fpath[1]}/_fastvmctl"
```

## SEE ALSO

[fastvmctl](fastvmctl.md)
