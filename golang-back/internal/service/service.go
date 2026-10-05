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

type Notes interface {
	Create(note *model.NoteModel) (int, error)
	Get(ctx context.Context, id int) (*model.NoteModel, error)
	Update(ctx context.Context, id int, title, body *string) (*model.NoteModel, error)
	Delete(ctx context.Context, id int) (bool, error)
	List(limit, offset int) (model.NotePage, error)
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
	Notes
	Primes
}

func NewService(repos *repository.Repository, cache *redis.Client) *Service {
	return &Service{
		Fibonacci: NewFibonacciService(cache),
		Number:    NewNumberService(repos.Number),
		Notes:     NewNotesService(repos.Notes, cache),
		Primes:    NewPrimesService(),
	}
}
