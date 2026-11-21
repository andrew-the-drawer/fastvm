package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"fastvm/internal/manager"
)

type metricsRuntime struct {
	manager.Runtime
	body []byte
}

func (m metricsRuntime) PrometheusMetrics(context.Context) ([]byte, error) { return m.body, nil }

func TestMetricsEndpoint(t *testing.T) {
	body := []byte("# HELP fastvm_up\ntext\nfastvm_up 1\n")
	s := New(metricsRuntime{body: body}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/plain") {
		t.Fatalf("content type = %q", got)
	}
	data, _ := io.ReadAll(rec.Result().Body)
	if string(data) != string(body) {
		t.Fatalf("body = %q", data)
	}
}
