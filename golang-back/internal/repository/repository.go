package repository

import (
	"golang-back/internal/model"

	"github.com/jmoiron/sqlx"
)

type Number interface {
	Create(number int) (int, error)
	List() ([]model.NumberModel, error)
}

type Repository struct {
	Number
}

func NewRepository(db *sqlx.DB) *Repository {
	return &Repository{
		Number: NewNumberRepository(db),
	}
}
