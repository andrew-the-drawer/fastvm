package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	tpl "fastvm/internal/template"
	"fastvm/internal/types"
)

func cmdTemplateList() error {
	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "NAME\tAGENT\tVCPUS\tMEM\tENV\tIMAGE\tDESCRIPTION")
	for _, t := range tpl.List() {
		fmt.Fprintf(tw, "%s\t%s\t%d\t%dM\t%s\t%s\t%s\n",
			t.Name, t.Agent, t.VCPUs, t.MemoryMB,
			strings.Join(t.EnvKeys, ","), t.ImageTag(), t.Description)
	}
	return tw.Flush()
}

type templateStartOptions struct {
	Name        string
	Detached    bool
	Envs        []string
	VCPUs       int
	MemoryMB    int
	NoAutoSleep bool
}

// splitTemplateArgs separates the template name from flags so the name may
// appear before or after flags: `template start copilot -d` and
// `template start -d copilot` both work.
func templateStart(templateName string, opts templateStartOptions) error {
	if templateName == "" {
		names := make([]string, 0)
		for _, t := range tpl.List() {
			names = append(names, t.Name)
		}
		return fmt.Errorf("template start: template name required (available: %s)", strings.Join(names, ", "))
	}
	t, ok := tpl.Get(templateName)
	if !ok {
		names := make([]string, 0)
		for _, t := range tpl.List() {
			names = append(names, t.Name)
		}
		return fmt.Errorf("template start: unknown template %q (available: %s)", templateName, strings.Join(names, ", "))
	}

	if err := requireTemplateImage(t); err != nil {
		return err
	}

	explicit, err := parseEnvs(opts.Envs)
	if err != nil {
		return err
	}
	env := map[string]string{}
	for _, k := range t.EnvKeys {
		if v := os.Getenv(k); v != "" {
			env[k] = v
		}
	}
	for k, v := range explicit {
		env[k] = v
	}

	name := opts.Name
	if name == "" {
		name = t.Name + "-" + randomSuffix()
	}
	vcpus := opts.VCPUs
	if vcpus == 0 {
		vcpus = t.VCPUs
	}
	memory := opts.MemoryMB
	if memory == 0 {
		memory = t.MemoryMB
	}
	body := map[string]any{
		"name":          name,
		"image":         t.ImageTag(),
		"vcpus":         vcpus,
		"memory_mb":     memory,
		"cmd":           []string{"/bin/sh", "-c", "exec sleep infinity"},
		"env":           env,
		"no_auto_sleep": opts.NoAutoSleep,
	}
	var sb types.Sandbox
	if err := do(http.MethodPost, "/v1/sandboxes", body, &sb); err != nil {
		return fmt.Errorf("template start %s: %w", t.Name, err)
	}

	var missing []string
	for _, k := range t.EnvKeys {
		if _, ok := env[k]; !ok {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		fmt.Fprintf(os.Stderr, "note: set %s (or pass --env K=V) so %s can authenticate\n",
			strings.Join(missing, " or "), t.Agent)
	}

	if opts.Detached {
		// Contract: stdout is exactly the sandbox name, for scripts:
		//   vm=$(fastvm template start copilot -d)
		fmt.Println(sb.Name)
		return nil
	}

	fmt.Printf("%s\t%s\t%s\n", sb.ID, sb.State, sb.Name)
	fmt.Fprintf(os.Stderr, "template: %s (%s)\n", t.Name, t.ImageTag())
	fmt.Fprintf(os.Stderr, "agent:    %s\n", t.Agent)
	fmt.Fprintf(os.Stderr, "exec:     fastvm exec %s -- %s --help\n", sb.Name, t.Agent)
	fmt.Fprintf(os.Stderr, "shell:    fastvm shell %s\n", sb.Name)
	fmt.Fprintf(os.Stderr, "lifecycle: fastvm pause %s / fastvm resume %s\n", sb.Name, sb.Name)
	return nil
}

// requireTemplateImage checks that the referenced image has been built. The
// Dockerfiles live in hack/templates and are built by `make template-images`
// (or a CI pipeline), not implicitly by the CLI.
func requireTemplateImage(t tpl.Template) error {
	tag := t.ImageTag()
	var disks []types.BaseDisk
	if err := getJSON("/v1/images", &disks); err != nil {
		return fmt.Errorf("template start: list images: %w", err)
	}
	for _, d := range disks {
		if d.Tag == tag {
			return nil
		}
	}
	return fmt.Errorf("template start: image %s is not built; run 'sudo make template-images' "+
		"(or: fastvm image build -f hack/templates/%s.Dockerfile -t %s hack/templates)",
		tag, t.Name, tag)
}

func randomSuffix() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err == nil {
		return hex.EncodeToString(b[:])
	}
	return strconv.FormatInt(time.Now().UnixNano(), 36)
}
