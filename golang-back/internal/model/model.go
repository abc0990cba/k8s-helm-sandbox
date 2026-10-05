package model

import (
	"encoding/json"
	"fmt"
	"time"
)

type NumberModel struct {
	Id     int `json:"id" db:"id"`
	Number int `json:"number" db:"number" binding:"required"`
}

type NumberInput struct {
	Number int `json:"number" binding:"required"`
}

type NoteInput struct {
	Title *string `json:"title" binding:"required"`
	Body  *string `json:"body"`
}

type NotePatch struct {
	Title *string `json:"title"`
	Body  *string `json:"body"`
}

type NoteModel struct {
	Id        int       `json:"id" db:"id"`
	Title     string    `json:"title" db:"title"`
	Body      string    `json:"body" db:"body"`
	Owner     string    `json:"owner" db:"owner"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type NotePage struct {
	Items  []NoteModel `json:"items"`
	Total  int         `json:"total"`
	Limit  int         `json:"limit"`
	Offset int         `json:"offset"`
}

type JobModel struct {
	Id        string    `json:"id" db:"id"`
	Type      string    `json:"type" db:"type"`
	Status    string    `json:"status" db:"status"`
	Payload   JSONMap   `json:"payload" db:"payload"`
	Result    JSONMap   `json:"result" db:"result"`
	Error     *string   `json:"error" db:"error"`
	CreatedBy string    `json:"created_by" db:"created_by"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// JSONB columns arrive from lib/pq as []byte; sqlx scans them through here
type JSONMap map[string]any

func (m *JSONMap) Scan(src any) error {
	if src == nil {
		*m = nil
		return nil
	}
	var data []byte
	switch v := src.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return fmt.Errorf("unsupported jsonb source type %T", src)
	}
	return json.Unmarshal(data, m)
}
