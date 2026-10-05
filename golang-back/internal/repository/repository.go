package repository

import (
	"golang-back/internal/model"

	"github.com/jmoiron/sqlx"
)

type Number interface {
	Create(number int) (int, error)
	List() ([]model.NumberModel, error)
}

type Notes interface {
	Create(note *model.NoteModel) (int, error)
	Get(id int) (*model.NoteModel, error)
	Update(id int, title, body *string) (*model.NoteModel, error)
	Delete(id int) (bool, error)
	List(limit, offset int) (model.NotePage, error)
}

type Repository struct {
	Number
	Notes
}

func NewRepository(db *sqlx.DB) *Repository {
	return &Repository{
		Number: NewNumberRepository(db),
		Notes:  NewNotesRepository(db),
	}
}
