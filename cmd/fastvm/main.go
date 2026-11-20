// Command fastvmctl is the fastvm CLI client.
package main

import (
	"context"
	"os"

	"github.com/charmbracelet/fang"
	"github.com/spf13/cobra"

	"fastvm/internal/version"
)

func main() {
	root := newRootCmd()
	if err := fang.Execute(context.Background(), root, fang.WithVersion(version.String())); err != nil {
		os.Exit(1)
	}
}

func newRootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "fastvmctl",
		Short: "Micro-VM sandbox runtime",
		Long: `fastvmctl controls fastvmd and its Cloud Hypervisor sandboxes.

Create sandboxes from OCI images on demand, choose networking and egress
policy, attach a PTY, or snapshot a running sandbox and restore copies.

Run without a command to see the full command reference.`,
		Version: version.String(),
	}
	root.PersistentFlags().StringVar(&socketFlag, "socket", "",
		"fastvmd unix socket (default: $FASTVM_SOCKET or "+defaultSocket+")")
	root.AddCommand(
		newImageCmd(),
		newRunCmd(),
		newSnapshotCmd(),
		newListCmd(),
		newGetCmd(),
		newExecCmd(),
		newShellCmd(),
		newPauseCmd(),
		newResumeCmd(),
		newDeleteCmd(),
		newEventsCmd(),
		newVersionCmd(),
	)
	return root
}
