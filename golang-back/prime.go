package main

import (
	"fmt"
	"math"
	"runtime"
	"sync"
	"time"
)

type PrimeNumberAlg int

// algs:
// https://www.geeksforgeeks.org/sieve-of-eratosthenes/
// https://en.wikipedia.org/wiki/Sieve_of_Eratosthenes
// https://www.geeksforgeeks.org/how-is-the-time-complexity-of-sieve-of-eratosthenes-is-nloglogn/?ref=oin_asr2
// https://www.geeksforgeeks.org/sieve-of-atkin/
// https://github.com/mcdxwell/sieve-of-atkin

const (
	SIMPLE_ALG PrimeNumberAlg = iota
	ERATO_ALG
	ATKINS_ALG
)

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

func calcSimpleParallel(numWorkers, limit int) (int, time.Duration) {
	var count int

	results := make(chan int, limit)

	var wg sync.WaitGroup

	chunkSize := limit / numWorkers

	start := time.Now()
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

	for _ = range results {
		count++
	}

	duration := time.Since(start)

	return count, duration
}

func calcSieveAtkin(limit int) (int, time.Duration) {
	sieve := make([]bool, limit)

	start := time.Now()

	for i := 0; i < limit; i++ {
		sieve[i] = false
	}

	var n int
	for x := 1; x*x <= limit; x++ {
		for y := 1; y*y <= limit; y++ {
			n = 4*x*x + y*y
			if n <= limit && (n%12 == 1 || n%12 == 5) {
				sieve[n] = !sieve[n]
			}

			n = 3*x*x + y*y
			if n <= limit && n%12 == 7 {
				sieve[n] = !sieve[n]
			}

			n = 3*x*x - y*y
			if x > y && n <= limit && n%12 == 11 {
				sieve[n] = !sieve[n]
			}
		}
	}

	for r := 5; r*r < limit; r++ {
		if sieve[r] {
			for i := r * r; i < limit; i += r * r {
				sieve[i] = false
			}
		}
	}

	var primes []int

	primes = append(primes, 2, 3)

	for i := 5; i < limit; i++ {
		if sieve[i] {
			primes = append(primes, i)
		}
	}

	duration := time.Since(start)

	return len(primes), duration
}

func calcSieveErato(limit int) (int, time.Duration) {
	sieve := make([]bool, limit+1)

	start := time.Now()

	for i := 2; i <= limit; i++ {
		sieve[i] = true
	}

	for i := 2; i*i <= limit; i++ {
		if sieve[i] {
			for j := i * i; j <= limit; j += i {
				sieve[j] = false
			}
		}
	}

	var primes []int
	for i := 2; i <= limit; i++ {
		if sieve[i] {
			primes = append(primes, i)
		}
	}

	duration := time.Since(start)

	return len(primes), duration
}

func printResults(alg PrimeNumberAlg, limit, count, numWorkers int, duration time.Duration) {
	fmt.Println("===================================================")
	fmt.Printf("Alg: %d\n", alg)
	fmt.Printf("Number of prime numbers up to %d: %d\n", limit, count)
	fmt.Printf("Time taken for %v workers : %v\n", numWorkers, duration)
}

func main() {
	const PRIME_NUMBERS_LIMIT = 1_000_000
	WORKERS_NUM := runtime.NumCPU()

	count, duration := calcSimpleParallel(1, PRIME_NUMBERS_LIMIT)
	printResults(SIMPLE_ALG, PRIME_NUMBERS_LIMIT, count, 1, duration)

	count, duration = calcSimpleParallel(WORKERS_NUM, PRIME_NUMBERS_LIMIT)
	printResults(SIMPLE_ALG, PRIME_NUMBERS_LIMIT, count, WORKERS_NUM, duration)

	count, duration = calcSieveErato(PRIME_NUMBERS_LIMIT)
	printResults(ERATO_ALG, PRIME_NUMBERS_LIMIT, count, 1, duration)

	count, duration = calcSieveAtkin(PRIME_NUMBERS_LIMIT)
	printResults(ATKINS_ALG, PRIME_NUMBERS_LIMIT, count, 1, duration)
}
