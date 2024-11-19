package service

import (
	"math/big"

	"github.com/redis/go-redis/v9"
	"golang.org/x/net/context"

	"golang-back/internal/model"
	"golang-back/internal/repository"
)

type Number interface {
	List() ([]model.NumberModel, error)
	Create(int) (int, error)
}

type Fibonacci interface {
	GetFibonacciSum(context.Context, int) (*big.Int, error)
}

type Primes interface {
	GetPrimesAmount(context.Context, int, int) (int, error)
}
type Service struct {
	Fibonacci
	Number
	Primes
}

func NewService(repos *repository.Repository, cache *redis.Client) *Service {
	return &Service{
		Fibonacci: NewFibonacciService(cache),
		Number:    NewNumberService(repos.Number),
		Primes:    NewPrimesService(),
	}
}
