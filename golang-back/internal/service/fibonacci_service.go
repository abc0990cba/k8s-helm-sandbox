package service

import (
	"math/big"
)

type FibonacciService struct {
}

func NewFibonacciService() *FibonacciService {
	return &FibonacciService{}
}

func (s *FibonacciService) GetFibonacciSum(num int) *big.Int {
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

	return &a
}
