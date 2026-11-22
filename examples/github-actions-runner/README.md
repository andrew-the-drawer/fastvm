# GitHub Actions runner

Starts a self-hosted Actions runner inside a sandbox using the official runner
image.

```sh
export RUNNER_TOKEN=...   # repository runner registration token
export REPO_URL=https://github.com/org/repo

fastvmctl run -d -f examples/github-actions-runner/runner.fvmfile
fastvmctl exec github-runner -- ps aux
```

Get a registration token from:

```text
GitHub repo -> Settings -> Actions -> Runners -> New self-hosted runner
```

The token is short-lived. Do not use a personal access token.

## Caveats

- This is an ephemeral runner example; it does not persist registration across
  sandbox deletion.
- Jobs that require nested Docker or privileged host access are not supported
  by this example. Use the Docker-in-VM example as a base if jobs need
  containers.
- The runner needs unrestricted egress to GitHub and downloaded actions.
- Pin the runner image tag for reproducible use.
