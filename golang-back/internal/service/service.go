package service

import (
	"golang-back/internal/model"
	"golang-back/internal/repository"
	"math/big"
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

func NewService(repos *repository.Repository) *Service {
	return &Service{
		Fibonacci: NewFibonacciService(),
		Number:    NewNumberService(repos.Number),
	}
}
