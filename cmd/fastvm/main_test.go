package main

import (
	"reflect"
	"testing"

	"fastvm/internal/types"
)

func TestParsePublishes(t *testing.T) {
	got, err := parsePublishes([]string{"8080:80", "53:53/udp", "9000:9000/tcp"})
	if err != nil {
		t.Fatal(err)
	}
	want := []types.PortMapping{
		{HostPort: 8080, GuestPort: 80, Proto: "tcp"},
		{HostPort: 53, GuestPort: 53, Proto: "udp"},
		{HostPort: 9000, GuestPort: 9000, Proto: "tcp"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v want %+v", got, want)
	}
	for _, bad := range []string{"", "8080", "abc:80", "0:80", "80:0", "80:80/icmp"} {
		if _, err := parsePublishes([]string{bad}); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

func TestParseEnvs(t *testing.T) {
	got, err := parseEnvs([]string{"A=1", "B=x=y", "C="})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"A": "1", "B": "x=y", "C": ""}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if _, err := parseEnvs([]string{"NOEQUALS"}); err == nil {
		t.Fatal("expected error without =")
	}
	if env, err := parseEnvs(nil); err != nil || env != nil {
		t.Fatalf("nil envs = %v, %v", env, err)
	}
}
