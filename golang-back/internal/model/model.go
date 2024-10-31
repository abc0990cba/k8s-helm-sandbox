package model

type NumberModel struct {
	Id     int `json:"id" db:"id"`
	Number int `json:"number" db:"number" binding:"required"`
}
