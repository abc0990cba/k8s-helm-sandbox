package handler

import "testing"

func TestParseIntOr(t *testing.T) {
	if got := parseIntOr("7", 20); got != 7 {
		t.Errorf("parseIntOr(\"7\") = %d", got)
	}
	if got := parseIntOr("junk", 20); got != 20 {
		t.Errorf("parseIntOr(\"junk\") = %d, want fallback 20", got)
	}
}

func TestClampInt(t *testing.T) {
	for _, tc := range []struct{ in, lo, hi, want int }{
		{50, 1, 100, 50}, {0, 1, 100, 1}, {500, 1, 100, 100},
	} {
		if got := clampInt(tc.in, tc.lo, tc.hi); got != tc.want {
			t.Errorf("clampInt(%d,%d,%d) = %d, want %d", tc.in, tc.lo, tc.hi, got, tc.want)
		}
	}
}
