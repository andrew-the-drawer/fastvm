package agent

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseProcNetTCP(t *testing.T) {
	data := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1
   1: 0100007F:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2
   2: 0F02000A:1F91 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3
   3: 00000000:1F92 00000000:0000 01 00000000:00000000 00:00000000 00000000     0        0 4
`
	ports, err := parseProcNetTCP(strings.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	want := []int{8080, 8081}
	if !reflect.DeepEqual(ports, want) {
		t.Fatalf("ports = %v, want %v", ports, want)
	}
}

func TestParseProcNetTCP6(t *testing.T) {
	data := `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1
   1: 00000000000000000000000001000000:0050 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2
`
	ports, err := parseProcNetTCP(strings.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(ports, []int{8080}) {
		t.Fatalf("ports = %v", ports)
	}
}
