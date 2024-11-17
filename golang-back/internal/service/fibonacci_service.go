package service

import (
	"context"
	"fmt"
	"math/big"

	"github.com/redis/go-redis/v9"
)

type FibonacciService struct {
	cache *redis.Client
}

func NewFibonacciService(cache *redis.Client) *FibonacciService {
	return &FibonacciService{cache: cache}
}

func (s *FibonacciService) GetFibonacciSum(num int) *big.Int {
	ctx := context.Background()

	cacheKey := fmt.Sprintf("fiboNum:%d", num)
	cachedSum, err := s.cache.Get(ctx, cacheKey).Result()
	if err == redis.Nil {
		fmt.Printf("%s key does not exist in redis", cacheKey)
	} else if err != nil {
		panic(err)
	} else {
		n := new(big.Int)
		n, ok := n.SetString(cachedSum, 10)
		if !ok {
			fmt.Println("SetString: error for cached Sum cast key=%s value%s", cacheKey, cachedSum)
		} else {
			fmt.Printf("return fibo sum from cache key=%s value%s", cacheKey, cachedSum)
			return n
		}

		fmt.Printf("no cache value for key=%s", cacheKey)
	}

	if num <= 1 {
		return big.NewInt(int64(num))
	}

	var a, b big.Int
	a.SetInt64(0)
	b.SetInt64(1)

	for i := 2; i <= num; i++ {
		a.Add(&a, &b)
		a, b = b, a
	}

	err = s.cache.Set(ctx, cacheKey, a.String(), 0).Err()
	if err != nil {
		panic(err)
	}

	return &a
}
