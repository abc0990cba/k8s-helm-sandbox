package repository

import (
	"fmt"

	"github.com/jmoiron/sqlx"

	"golang-back/internal/model"
)

type FiboRepository struct {
	db *sqlx.DB
}

func NewNumberRepository(db *sqlx.DB) *FiboRepository {
	return &FiboRepository{db: db}
}

func (repo *FiboRepository) Create(sum int) (int, error) {
	var id int
	query := fmt.Sprintf("INSERT INTO %s (number) values ($1) RETURNING id", numbersTable)
	row := repo.db.QueryRow(query, sum)
	if err := row.Scan(&id); err != nil {
		return 0, err
	}

	return id, nil
}

func (repo *FiboRepository) List() ([]model.NumberModel, error) {
	var items []model.NumberModel
	query := fmt.Sprintf("SELECT id, number FROM %s", numbersTable)

	if err := repo.db.Select(&items, query); err != nil {
		return nil, err
	}

	return items, nil
}
