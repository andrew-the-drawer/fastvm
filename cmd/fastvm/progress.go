package main

import (
	"fmt"
	"os"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"

	"fastvm/internal/types"
)

type imageBuildResult struct {
	disk types.BaseDisk
	err  error
}

type imageBuildModel struct {
	ref     string
	spinner spinner.Model
	start   time.Time
	result  <-chan imageBuildResult
	done    bool
	disk    types.BaseDisk
	err     error
}

func newImageBuildModel(ref string, result <-chan imageBuildResult) imageBuildModel {
	return imageBuildModel{
		ref:     ref,
		spinner: spinner.New(spinner.WithSpinner(spinner.Dot)),
		start:   time.Now(),
		result:  result,
	}
}

func (m imageBuildModel) Init() tea.Cmd {
	return tea.Batch(
		func() tea.Msg { return m.spinner.Tick() },
		waitForImageBuild(m.result),
	)
}

func waitForImageBuild(ch <-chan imageBuildResult) tea.Cmd {
	return func() tea.Msg {
		return <-ch
	}
}

func (m imageBuildModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case imageBuildResult:
		m.done = true
		m.disk = msg.disk
		m.err = msg.err
		return m, tea.Quit
	default:
		return m, nil
	}
}

func (m imageBuildModel) View() tea.View {
	if m.done {
		return tea.NewView("")
	}
	return tea.NewView(fmt.Sprintf(
		"%s Building image %s\n\n"+
			"  This can take a few minutes on the first build:\n"+
			"  docker build → export rootfs → inject agent → create ext4 disk\n\n"+
			"  elapsed %s",
		m.spinner.View(),
		m.ref,
		time.Since(m.start).Round(time.Second),
	))
}

// buildImageWithProgress runs a synchronous image build behind a Bubbles
// spinner when the CLI is attached to a terminal. Non-interactive callers get
// a single status line on stderr instead, preserving machine-readable stdout.
func buildImageWithProgress(ref string, build func() (types.BaseDisk, error)) (types.BaseDisk, error) {
	info, err := os.Stderr.Stat()
	if err != nil || info.Mode()&os.ModeCharDevice == 0 || os.Getenv("TERM") == "dumb" {
		fmt.Fprintf(os.Stderr, "building image %s...\n", ref)
		return build()
	}

	results := make(chan imageBuildResult, 1)
	go func() {
		disk, buildErr := build()
		results <- imageBuildResult{disk: disk, err: buildErr}
	}()

	model := newImageBuildModel(ref, results)
	final, err := tea.NewProgram(model, tea.WithInput(nil), tea.WithOutput(os.Stderr)).Run()
	if err != nil {
		return types.BaseDisk{}, err
	}
	done, ok := final.(imageBuildModel)
	if !ok {
		return types.BaseDisk{}, fmt.Errorf("image build progress: unexpected model %T", final)
	}
	if done.err != nil {
		return types.BaseDisk{}, done.err
	}
	fmt.Fprintf(os.Stderr, "✓ built image %s (%s)\n", done.ref, short(done.disk.Digest))
	return done.disk, nil
}
