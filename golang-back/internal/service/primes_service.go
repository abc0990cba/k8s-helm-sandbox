package service

import (
	"context"
	"math"
	"sync"
)

type PrimesService struct {
}

func NewPrimesService() *PrimesService {
	return &PrimesService{}
}

func isPrime(limit int) bool {
	if limit <= 1 {
		return false
	}
	for i := 2; i <= int(math.Sqrt(float64(limit))); i++ {
		if limit%i == 0 {
			return false
		}
	}
	return true
}

func worker(start, end int, results chan<- int, wg *sync.WaitGroup) {
	defer wg.Done()
	for i := start; i <= end; i++ {
		if isPrime(i) {
			results <- i
		}
	}
}

func (s *PrimesService) GetPrimesAmount(ctx context.Context, numWorkers, limit int) (int, error) {

	results := make(chan int, limit+1)

	var wg sync.WaitGroup

	// partition 2..limit into contiguous chunks (the old math skipped most
	// numbers: chunkSize=limit/numWorkers with start=i*chunkSize+2 left gaps —
	// π(10) counted 1 instead of 4)
	if limit < 2 {
		return 0, nil
	}
	chunkSize := (limit - 1) / numWorkers
	if chunkSize == 0 {
		chunkSize = 1
	}

	for i := 0; i < numWorkers; i++ {
		start := 2 + i*chunkSize
		end := start + chunkSize - 1
		if end > limit {
			end = limit
		}

		wg.Add(1)

		go worker(start, end, results, &wg)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	var count int

	for _ = range results {
		count++
	}

	return count, nil
}
