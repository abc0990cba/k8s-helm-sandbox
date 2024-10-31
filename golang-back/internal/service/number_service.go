package service

import (
	"golang-back/internal/model"
	"golang-back/internal/repository"
)

type NumberService struct {
	repo repository.Number
}

func NewNumberService(repo repository.Number) *NumberService {
	return &NumberService{repo: repo}
}

func (s *NumberService) List() ([]model.NumberModel, error) {
	return s.repo.List()
}

func (s *NumberService) Create(number int) (int, error) {
	return s.repo.Create(number)
}
