package repository

import (
	"fmt"

	"github.com/jmoiron/sqlx"

	"golang-back/internal/model"
)

type NotesRepository struct {
	db *sqlx.DB
}

func NewNotesRepository(db *sqlx.DB) *NotesRepository {
	return &NotesRepository{db: db}
}

const notesColumns = "id, title, body, owner, created_at, updated_at"

func (r *NotesRepository) Create(note *model.NoteModel) (int, error) {
	var id int
	query := fmt.Sprintf(
		"INSERT INTO %s (title, body, owner) VALUES ($1, $2, $3) RETURNING id",
		notesTable,
	)
	if err := r.db.QueryRow(query, note.Title, note.Body, note.Owner).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

func (r *NotesRepository) Get(id int) (*model.NoteModel, error) {
	var note model.NoteModel
	query := fmt.Sprintf("SELECT %s FROM %s WHERE id = $1", notesColumns, notesTable)
	if err := r.db.Get(&note, query, id); err != nil {
		return nil, err
	}
	return &note, nil
}

// partial update: nil fields keep their value
func (r *NotesRepository) Update(id int, title, body *string) (*model.NoteModel, error) {
	var note model.NoteModel
	query := fmt.Sprintf(`
		UPDATE %s SET
			title = COALESCE($1, title),
			body = COALESCE($2, body),
			updated_at = now()
		WHERE id = $3
		RETURNING %s`, notesTable, notesColumns)
	if err := r.db.Get(&note, query, title, body, id); err != nil {
		return nil, err
	}
	return &note, nil
}

func (r *NotesRepository) Delete(id int) (bool, error) {
	res, err := r.db.Exec(fmt.Sprintf("DELETE FROM %s WHERE id = $1", notesTable), id)
	if err != nil {
		return false, err
	}
	rows, err := res.RowsAffected()
	return rows > 0, err
}

func (r *NotesRepository) List(limit, offset int) (model.NotePage, error) {
	page := model.NotePage{Items: []model.NoteModel{}, Limit: limit, Offset: offset}

	query := fmt.Sprintf(
		"SELECT %s FROM %s ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2",
		notesColumns, notesTable,
	)
	if err := r.db.Select(&page.Items, query, limit, offset); err != nil {
		return page, err
	}
	if err := r.db.Get(&page.Total, "SELECT count(*) FROM "+notesTable); err != nil {
		return page, err
	}
	return page, nil
}
