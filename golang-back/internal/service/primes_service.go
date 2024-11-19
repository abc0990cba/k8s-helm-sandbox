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

	results := make(chan int, limit)

	var wg sync.WaitGroup

	chunkSize := limit / numWorkers

	for i := 0; i < numWorkers; i++ {
		start := i*chunkSize + 2
		end := (i + 1) * chunkSize
		if i == numWorkers-1 {
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
