package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"

	"fastvm/internal/types"
	"fastvm/internal/version"
)

// --- image -----------------------------------------------------------------

func newImageCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "image",
		Short: "Manage base images",
	}
	cmd.AddCommand(newImageBuildCmd(), newImageListCmd(), newImageRemoveCmd())
	return cmd
}

func newImageBuildCmd() *cobra.Command {
	var dockerfile, tag string
	var sizeGB int
	cmd := &cobra.Command{
		Use:   "build [context]",
		Short: "Build a base disk from a Dockerfile",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if tag == "" {
				return errors.New("--tag is required")
			}
			ctxDir := "."
			if len(args) > 0 {
				ctxDir = args[0]
			}
			var disk types.BaseDisk
			if err := do(http.MethodPost, "/v1/images/build", map[string]any{
				"dockerfile": dockerfile, "context": ctxDir, "tag": tag, "size_gb": sizeGB,
			}, &disk); err != nil {
				return err
			}
			fmt.Printf("%s\t%s\t%d bytes\n", disk.Name, disk.Digest, disk.SizeBytes)
			return nil
		},
	}
	cmd.Flags().StringVarP(&dockerfile, "file", "f", "", "path to Dockerfile")
	cmd.Flags().StringVarP(&tag, "tag", "t", "", "image tag")
	cmd.Flags().IntVar(&sizeGB, "size-gb", 0, "base disk size in GiB")
	return cmd
}

func newImageListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "ls",
		Aliases: []string{"list"},
		Short:   "List base images",
		Args:    cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var disks []types.BaseDisk
			if err := getJSON("/v1/images", &disks); err != nil {
				return err
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "TAG\tDIGEST\tSIZE\tSOURCE")
			for _, d := range disks {
				tag := "-"
				if len(d.Tags) > 0 {
					tag = strings.Join(d.Tags, ",")
				} else if d.Tag != "" {
					tag = d.Tag
				}
				fmt.Fprintf(tw, "%s\t%s\t%d MiB\t%s\n", tag, short(d.Digest), d.SizeBytes/(1<<20), d.Source)
			}
			return tw.Flush()
		},
	}
}

func newImageRemoveCmd() *cobra.Command {
	var force bool
	cmd := &cobra.Command{
		Use:     "rm <tag|digest>...",
		Aliases: []string{"remove"},
		Short:   "Delete base images",
		Args:    cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, refs []string) error {
			for _, ref := range refs {
				path := "/v1/images?ref=" + url.QueryEscape(ref)
				if force {
					path += "&force=1"
				}
				var disk types.BaseDisk
				if err := do(http.MethodDelete, path, nil, &disk); err != nil {
					return err
				}
				fmt.Printf("deleted %s (%s)\n", disk.Identity(), short(disk.Digest))
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&force, "force", false, "delete even while sandboxes reference the image")
	return cmd
}

// --- sandbox lifecycle ------------------------------------------------------

type networkOptions struct {
	net         bool
	noNet       bool
	allowHosts  []string
	interactive bool
	tty         bool
	noAutoSleep bool
}

func addNetworkFlags(cmd *cobra.Command, opts *networkOptions) {
	cmd.Flags().BoolVar(&opts.net, "net", false, "enable networking (default: off)")
	cmd.Flags().BoolVar(&opts.noNet, "no-net", false, "explicitly disable networking")
	cmd.Flags().StringArrayVar(&opts.allowHosts, "allow-host", nil,
		"allow egress only to this host (repeatable; requires --net)")
	cmd.Flags().BoolVar(&opts.noAutoSleep, "no-auto-sleep", false, "never auto-sleep")
}

func (o *networkOptions) enabled() bool { return o.net && !o.noNet }

func (o *networkOptions) validate(cmdName string) error {
	if o.net && o.noNet {
		return fmt.Errorf("%s: --net and --no-net are mutually exclusive", cmdName)
	}
	if len(o.allowHosts) > 0 && !o.enabled() {
		return fmt.Errorf("%s: --allow-host requires --net", cmdName)
	}
	return nil
}

func newRunCmd() *cobra.Command {
	var image, name, file, fromSnapshot string
	var vcpus, memory int
	var publishes, envs, volumes []string
	var detach, noStart bool
	var opts networkOptions
	cmd := &cobra.Command{
		Use:   "run [flags] -- <command> [args...]",
		Short: "Create, boot, or start a sandbox",
		Long: `Create and boot a sandbox from an image or an .fvmfile, or boot an
already-created sandbox.

The image reference is built into a base disk on demand if it is not already in
the image store. Pass the guest command after -- so its own flags are not parsed
by fastvmctl.

By default run waits for the command and streams its stdout/stderr, then removes
the one-off sandbox. An interactive -it shell is also removed on exit. Use -d to
keep the sandbox and start the command in the background. Use --no-start to
create without booting, then resume it later. A run with no command leaves the
sandbox running and prints its ID/state/name.`,
		Example: `  fastvmctl run --net --image alpine -- uname -a
  fastvmctl run --net -it --image alpine -- /bin/sh
  fastvmctl run -f hack/codex.fvmfile
  fastvmctl run --image alpine --name agent --no-start
  fastvmctl run --from-snapshot original-vm-20261119-182000 --name copy-1
  fastvmctl run --name agent`,
		Args: cobra.ArbitraryArgs,
		RunE: func(cobraCmd *cobra.Command, cmdArgs []string) error {
			if detach && (opts.interactive || opts.tty) {
				return errors.New("--detach and --interactive/--tty are mutually exclusive")
			}
			if noStart && (detach || opts.interactive || opts.tty || len(cmdArgs) > 0) {
				return errors.New("--no-start cannot be combined with a command, -d, -i, or -t")
			}

			if fromSnapshot != "" {
				if file != "" || cobraCmd.Flags().Changed("image") {
					return errors.New("--from-snapshot cannot be combined with --image or --file")
				}
				for _, flagName := range []string{"vcpus", "memory", "publish", "env", "volume", "net", "no-net", "allow-host", "no-auto-sleep"} {
					if cobraCmd.Flags().Changed(flagName) {
						return fmt.Errorf("--%s does not apply with --from-snapshot", flagName)
					}
				}
				if noStart {
					return errors.New("--no-start does not apply with --from-snapshot")
				}
				if name == "" {
					return errors.New("--name is required with --from-snapshot")
				}
				var sb types.Sandbox
				if err := do(http.MethodPost, "/v1/sandboxes", map[string]any{
					"name": name, "from_snapshot": fromSnapshot, "start": true,
				}, &sb); err != nil {
					return err
				}
				if detach || len(cmdArgs) == 0 {
					fmt.Printf("%s\t%s\t%s\n", sb.ID, sb.State, sb.Name)
					return nil
				}
				if opts.interactive || opts.tty {
					return removeAfterRun(sb.ID, runShell(sb.ID, cmdArgs))
				}
				return removeAfterRun(sb.ID, execSandbox(sb.ID, cmdArgs, nil))
			}

			runArgs := append([]string(nil), cmdArgs...)
			var ports []types.PortMapping
			var env map[string]string
			var vols []types.Volume
			noAutoSleep := false

			if file != "" {
				for _, flagName := range []string{"image", "vcpus", "memory", "publish", "env", "volume", "net", "no-net", "allow-host", "no-auto-sleep"} {
					if cobraCmd.Flags().Changed(flagName) {
						return fmt.Errorf("--%s cannot be combined with --file", flagName)
					}
				}
				spec, err := LoadFVMFile(file)
				if err != nil {
					return err
				}
				image = spec.Image
				if name == "" {
					name = spec.Name
				}
				vcpus, memory = spec.VCPUs, spec.MemoryMB
				ports, env, vols = spec.Ports, spec.Env, spec.Volumes
				opts.net, opts.noNet, opts.allowHosts = spec.NetworkEnabled, false, spec.AllowHosts
				noAutoSleep = spec.NoAutoSleep
				if len(runArgs) == 0 {
					runArgs = spec.Command
				}
			} else {
				if err := opts.validate("run"); err != nil {
					return err
				}
				if image == "" {
					if name == "" {
						return errors.New("--image, --file, or --name is required")
					}
					if noStart {
						return errors.New("--no-start requires --image or --file")
					}
					if len(cmdArgs) > 0 || detach || opts.interactive || opts.tty {
						return errors.New("booting an existing sandbox does not take a command or -d/-i/-t")
					}
					return resumeSandbox(name)
				}
				var err error
				if ports, err = parsePublishes(publishes); err != nil {
					return err
				}
				if env, err = parseEnvs(envs); err != nil {
					return err
				}
				if vols, err = parseVolumes(volumes); err != nil {
					return err
				}
				noAutoSleep = opts.noAutoSleep
			}

			if err := ensureImage(image); err != nil {
				return err
			}

			workload := []string(nil)
			if detach {
				workload = runArgs
			}
			body := map[string]any{
				"name": name, "image": image,
				"vcpus": vcpus, "memory_mb": memory,
				"ports": ports, "volumes": vols, "cmd": workload, "env": env,
				"no_auto_sleep": noAutoSleep, "start": !noStart,
				"network_enabled": opts.enabled(), "allow_hosts": opts.allowHosts,
			}
			var sb types.Sandbox
			if err := do(http.MethodPost, "/v1/sandboxes", body, &sb); err != nil {
				return err
			}
			if noStart || detach {
				fmt.Printf("%s\t%s\t%s\n", sb.ID, sb.State, sb.Name)
				return nil
			}
			if opts.interactive || opts.tty {
				argv := runArgs
				if len(argv) == 0 {
					argv = []string{"/bin/sh"}
				}
				return removeAfterRun(sb.ID, runShell(sb.ID, argv))
			}
			if len(runArgs) > 0 {
				return removeAfterRun(sb.ID, execSandbox(sb.ID, runArgs, env))
			}
			fmt.Printf("%s\t%s\t%s\n", sb.ID, sb.State, sb.Name)
			return nil
		},
	}
	f := cmd.Flags()
	f.StringVarP(&file, "file", "f", "", "load sandbox config from an .fvmfile")
	f.StringVar(&fromSnapshot, "from-snapshot", "", "boot a new sandbox from a saved snapshot")
	f.StringVar(&image, "image", "", "Docker image or base disk tag/digest")
	f.StringVar(&name, "name", "", "sandbox name or ID (boot it if no image/file is given)")
	f.IntVar(&vcpus, "vcpus", 0, "vCPUs (0 = default)")
	f.IntVar(&memory, "memory", 0, "memory MiB (0 = default)")
	f.StringArrayVar(&publishes, "publish", nil, "publish a port host:guest[/tcp|udp]")
	f.StringArrayVar(&envs, "env", nil, "workload env K=V")
	f.StringArrayVar(&volumes, "volume", nil, "mount a host directory: host:guest[:ro]")
	f.BoolVarP(&detach, "detach", "d", false, "run the command in the background and print the sandbox ID")
	f.BoolVar(&noStart, "no-start", false, "create without booting")
	f.BoolVarP(&opts.interactive, "interactive", "i", false, "attach an interactive PTY")
	f.BoolVarP(&opts.tty, "tty", "t", false, "allocate a TTY")
	addNetworkFlags(cmd, &opts)
	return cmd
}

func newSnapshotCmd() *cobra.Command {
	var name string
	cmd := &cobra.Command{
		Use:   "snapshot [sandbox]",
		Short: "Create, list, or remove snapshots",
		Long: `Pause a sandbox, save its RAM/CPU state and writable disk under the daemon
data directory, then resume it. Prints the generated snapshot name for use with
'run --from-snapshot'.

  snapshot <sandbox> [--name <name>]
                       create a snapshot (name generated by default)
  snapshot ls          list saved snapshots
  snapshot rm <name>   delete saved snapshots`,
		Args: cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return cmd.Help()
			}
			if len(args) != 1 {
				return errors.New("snapshot: expected one sandbox")
			}
			var resp struct {
				Snapshot string `json:"snapshot"`
			}
			if err := do(http.MethodPost, "/v1/sandboxes/"+url.PathEscape(args[0])+"/snapshot",
				map[string]any{"name": name}, &resp); err != nil {
				return err
			}
			fmt.Println(resp.Snapshot)
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "snapshot name (default: <sandbox>-<timestamp>)")
	cmd.AddCommand(newSnapshotListCmd(), newSnapshotRemoveCmd())
	return cmd
}

func newSnapshotListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "ls",
		Aliases: []string{"list"},
		Short:   "List saved snapshots",
		Args:    cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var snapshots []types.SnapshotInfo
			if err := getJSON("/v1/snapshots", &snapshots); err != nil {
				return err
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "NAME\tCREATED\tIMAGE\tVCPUS\tMEM")
			for _, c := range snapshots {
				created := "-"
				if !c.CreatedAt.IsZero() {
					created = c.CreatedAt.Local().Format("2006-01-02 15:04:05")
				}
				fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%dM\n",
					c.Name, created, short(c.ImageDigest), c.VCPUs, c.MemoryMB)
			}
			return tw.Flush()
		},
	}
}

func newSnapshotRemoveCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "rm <snapshot>...",
		Short: "Delete one or more saved snapshots",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, names []string) error {
			var errs []error
			for _, name := range names {
				if err := do(http.MethodDelete, "/v1/snapshots/"+url.PathEscape(name), nil, nil); err != nil {
					errs = append(errs, fmt.Errorf("rm snapshot %s: %w", name, err))
				}
			}
			return errors.Join(errs...)
		},
	}
}

// --- inspection/control ----------------------------------------------------

func newListCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "ls",
		Aliases: []string{"list"},
		Short:   "List sandboxes",
		Args:    cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var list []types.Sandbox
			if err := getJSON("/v1/sandboxes", &list); err != nil {
				return err
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "ID\tNAME\tSTATE\tIMAGE\tIP\tVCPUS\tMEM")
			for _, sb := range list {
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%d\t%dM\n",
					short(sb.ID), sb.Name, sb.State, short(sb.BaseDisk), sb.IP, sb.VCPUs, sb.MemoryMB)
			}
			return tw.Flush()
		},
	}
}

func newGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "get <sandbox>",
		Aliases: []string{"inspect"},
		Short:   "Show one sandbox as JSON",
		Args:    cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			var sb types.Sandbox
			if err := getJSON("/v1/sandboxes/"+args[0], &sb); err != nil {
				return err
			}
			b, _ := json.MarshalIndent(sb, "", "  ")
			fmt.Println(string(b))
			return nil
		},
	}
}

// execSandbox runs a non-interactive guest command and writes its stdout/stderr
// to the CLI streams. It returns the standard error for non-zero exit codes.
func execSandbox(ref string, argv []string, env map[string]string) error {
	var resp struct {
		ExitCode int    `json:"exit_code"`
		Stdout   string `json:"stdout"`
		Stderr   string `json:"stderr"`
		Error    string `json:"error"`
	}
	body := map[string]any{"argv": argv}
	if len(env) > 0 {
		body["env"] = env
	}
	if err := do(http.MethodPost, "/v1/sandboxes/"+url.PathEscape(ref)+"/exec", body, &resp); err != nil {
		return err
	}
	if resp.Stdout != "" {
		fmt.Print(resp.Stdout)
	}
	if resp.Stderr != "" {
		fmt.Fprint(os.Stderr, resp.Stderr)
	}
	if resp.Error != "" {
		fmt.Fprintln(os.Stderr, "guest:", resp.Error)
	}
	if resp.ExitCode != 0 {
		return fmt.Errorf("command exited with code %d", resp.ExitCode)
	}
	return nil
}

// removeAfterRun implements Docker-style foreground cleanup: a one-off
// sandbox is deleted when its command/shell exits. Detached runs never reach
// this helper.
func removeAfterRun(id string, runErr error) error {
	deleteErr := do(http.MethodDelete, "/v1/sandboxes/"+url.PathEscape(id), nil, nil)
	if runErr != nil {
		if deleteErr != nil {
			fmt.Fprintf(os.Stderr, "warning: could not remove sandbox %s: %v\n", short(id), deleteErr)
		}
		return runErr
	}
	return deleteErr
}

func newExecCmd() *cobra.Command {
	var interactive, tty bool
	cmd := &cobra.Command{
		Use:   "exec [flags] <sandbox> -- <command> [args...]",
		Short: "Run a command in a sandbox",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ref, argv := args[0], args[1:]
			interactive = interactive || tty
			if interactive {
				if len(argv) == 0 {
					argv = []string{"/bin/sh"}
				}
				return runShell(ref, argv)
			}
			if len(argv) == 0 {
				return errors.New("command required (or use -it for an interactive shell)")
			}
			return execSandbox(ref, argv, nil)
		},
	}
	cmd.Flags().BoolVarP(&interactive, "interactive", "i", false, "attach an interactive PTY")
	cmd.Flags().BoolVarP(&tty, "tty", "t", false, "allocate a TTY")
	return cmd
}

func newShellCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "shell <sandbox> [-- <command>...]",
		Short: "Open an interactive shell",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			argv := args[1:]
			if len(argv) == 0 {
				argv = []string{"/bin/sh"}
			}
			return runShell(args[0], argv)
		},
	}
}

func newPauseCmd() *cobra.Command {
	var deep bool
	cmd := &cobra.Command{
		Use:   "pause <sandbox>",
		Short: "Pause or offload a sandbox",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return do(http.MethodPost, "/v1/sandboxes/"+url.PathEscape(args[0])+"/sleep",
				map[string]any{"deep": deep}, nil)
		},
	}
	cmd.Flags().BoolVar(&deep, "deep", false, "offload memory to disk")
	return cmd
}

func newResumeCmd() *cobra.Command {
	var name string
	cmd := &cobra.Command{
		Use:   "resume [sandbox]",
		Short: "Boot a created sandbox or wake a paused/dormant one",
		Long: `Make an existing sandbox active:
  Created -> boot it
  Paused/Dormant -> wake/restore it

Running/idle sandboxes return an error; use exec instead.`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ref := name
			if ref == "" && len(args) > 0 {
				ref = args[0]
			}
			if ref == "" {
				return errors.New("sandbox required")
			}
			return resumeSandbox(ref)
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "sandbox name or ID")
	return cmd
}

// resumeSandbox dispatches the state-dependent meaning of `resume`.
func resumeSandbox(ref string) error {
	var sb types.Sandbox
	if err := getJSON("/v1/sandboxes/"+url.PathEscape(ref), &sb); err != nil {
		return err
	}
	switch sb.State {
	case types.StateCreated:
		if err := do(http.MethodPost, "/v1/sandboxes/"+url.PathEscape(sb.ID)+"/start", nil, nil); err != nil {
			return err
		}
	case types.StatePaused, types.StateDormant:
		if err := do(http.MethodPost, "/v1/sandboxes/"+url.PathEscape(sb.ID)+"/wake", nil, nil); err != nil {
			return err
		}
	case types.StateRunning, types.StateIdle:
		return fmt.Errorf("sandbox is already %s; use exec to run a command", sb.State)
	default:
		return fmt.Errorf("cannot resume sandbox in state %s", sb.State)
	}
	if err := getJSON("/v1/sandboxes/"+url.PathEscape(sb.ID), &sb); err != nil {
		return err
	}
	fmt.Printf("%s\t%s\t%s\n", sb.ID, sb.State, sb.Name)
	return nil
}

func newDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "rm <sandbox>...",
		Aliases: []string{"delete"},
		Short:   "Delete one or more sandboxes",
		Args:    cobra.MinimumNArgs(1),
		RunE: func(_ *cobra.Command, refs []string) error {
			var errs []error
			for _, ref := range refs {
				if err := do(http.MethodDelete, "/v1/sandboxes/"+url.PathEscape(ref), nil, nil); err != nil {
					errs = append(errs, fmt.Errorf("rm %s: %w", ref, err))
				}
			}
			return errors.Join(errs...)
		},
	}
}

func newEventsCmd() *cobra.Command {
	limit := 50
	cmd := &cobra.Command{
		Use:   "events",
		Short: "Show recent daemon events",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			var events []types.Event
			if err := getJSON(fmt.Sprintf("/v1/events?limit=%d", limit), &events); err != nil {
				return err
			}
			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "TIME\tNAME\tID\tTYPE\tMESSAGE")
			for _, ev := range events {
				name, id := ev.SandboxName, short(ev.SandboxID)
				if ev.SandboxID == "" || ev.SandboxID == "daemon" {
					name, id = "daemon", "-"
				} else if name == "" {
					name = "(unknown)"
				}
				fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
					ev.Time.Format("15:04:05.000"), name, id, ev.Type, ev.Message)
			}
			return tw.Flush()
		},
	}
	cmd.Flags().IntVarP(&limit, "limit", "n", 50, "number of events")
	return cmd
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Show CLI and daemon versions",
		Args:  cobra.NoArgs,
		RunE: func(*cobra.Command, []string) error {
			fmt.Printf("fastvmctl %s\n", version.String())
			var v map[string]string
			if err := getJSON("/v1/version", &v); err != nil {
				return err
			}
			fmt.Printf("fastvmd %s\n", v["version"])
			return nil
		},
	}
}
