package util

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func b64url(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func TestOwnerFromAuthorization(t *testing.T) {
	cases := []struct {
		name string
		hdr  string
		want string
	}{
		{"preferred_username wins", "Bearer x." + b64url(t, map[string]string{"preferred_username": "demo", "sub": "abc"}) + ".y", "demo"},
		{"falls back to sub", "x." + b64url(t, map[string]string{"sub": "abc-123"}) + ".y", "abc-123"},
		{"empty claims", "x." + b64url(t, map[string]string{}) + ".y", "anonymous"},
		{"garbage token", "not.a.jwt", "anonymous"},
		{"broken base64", "x.!!!not-base64!.y", "anonymous"},
		{"missing header", "", "anonymous"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := OwnerFromAuthorization(tc.hdr); got != tc.want {
				t.Errorf("OwnerFromAuthorization(%q) = %q, want %q", tc.hdr, got, tc.want)
			}
		})
	}
}
