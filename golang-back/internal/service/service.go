package service

import (
	"golang-back/internal/model"
	"golang-back/internal/repository"
	"math/big"

	"github.com/redis/go-redis/v9"
)

type Number interface {
	List() ([]model.NumberModel, error)
	Create(int) (int, error)
}

type Fibonacci interface {
	GetFibonacciSum(num int) *big.Int
}

type Service struct {
	Fibonacci
	Number
}

func NewService(repos *repository.Repository, cache *redis.Client) *Service {
	return &Service{
		Fibonacci: NewFibonacciService(cache),
		Number:    NewNumberService(repos.Number),
	}
}
