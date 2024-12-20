package service

import (
	"context"
	"fmt"
	"log"
	"math/big"

	"github.com/redis/go-redis/v9"
)

type FibonacciService struct {
	cache *redis.Client
}

func NewFibonacciService(cache *redis.Client) *FibonacciService {
	return &FibonacciService{cache: cache}
}

// TODO: add logger
func (s *FibonacciService) GetFibonacciSum(ctx context.Context, num int) (*big.Int, error) {
	cacheKey := fmt.Sprintf("fiboNum:%d", num)
	cachedSum, err := s.cache.Get(ctx, cacheKey).Result()
	if err == redis.Nil {
		log.Printf("%s key does not exist in redis\n", cacheKey)
	} else if err != nil {
		log.Println("[error]: error get cache key=%s", cacheKey)
	} else {
		num := new(big.Int)
		num, ok := num.SetString(cachedSum, 10)
		if ok {
			log.Printf("return fibonacci sum from cache key=%s\n", cacheKey)
			return num, nil
		} else {
			log.Println("[error]: error bigInt.SetString() for cached Sum cast key=%s", cacheKey)
		}
	}

	if num <= 1 {
		return big.NewInt(int64(num)), nil
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
		log.Printf("[error]: cache set error for key=%s\n", cacheKey)
		return nil, err
	}

	return &a, nil
}
