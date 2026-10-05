package service

import (
	"context"
	"testing"
)

func TestGetPrimesAmount(t *testing.T) {
	cases := []struct {
		limit int
		want  int
	}{
		{10, 4},   // 2, 3, 5, 7
		{2, 1},    // just 2
		{1, 0},    // no primes below 2
		{100, 25}, // known prime count π(100)
	}
	for _, tc := range cases {
		got, err := NewPrimesService().GetPrimesAmount(context.Background(), 4, tc.limit)
		if err != nil {
			t.Fatalf("limit=%d: %v", tc.limit, err)
		}
		if got != tc.want {
			t.Errorf("primes up to %d: got %d, want %d", tc.limit, got, tc.want)
		}
	}
}
