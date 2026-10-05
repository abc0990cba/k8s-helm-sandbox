package service

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"golang-back/internal/model"
	"golang-back/internal/repository"
)

const noteCacheTTL = time.Minute

type NotesService struct {
	repo  repository.Notes
	cache *redis.Client
}

func NewNotesService(repo repository.Notes, cache *redis.Client) *NotesService {
	return &NotesService{repo: repo, cache: cache}
}

func noteCacheKey(id int) string {
	return "note:" + strconv.Itoa(id)
}

func (s *NotesService) Create(note *model.NoteModel) (int, error) {
	return s.repo.Create(note)
}

// read-through cache: first hit fills note:<id> (TTL 60s); writes invalidate
func (s *NotesService) Get(ctx context.Context, id int) (*model.NoteModel, error) {
	cached, err := s.cache.Get(ctx, noteCacheKey(id)).Result()
	if err == nil {
		var note model.NoteModel
		if json.Unmarshal([]byte(cached), &note) == nil {
			return &note, nil
		}
	}

	note, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}
	if data, err := json.Marshal(note); err == nil {
		s.cache.Set(ctx, noteCacheKey(id), data, noteCacheTTL)
	}
	return note, nil
}

func (s *NotesService) Update(ctx context.Context, id int, title, body *string) (*model.NoteModel, error) {
	note, err := s.repo.Update(id, title, body)
	if err != nil {
		return nil, err
	}
	s.cache.Del(ctx, noteCacheKey(id))
	return note, nil
}

func (s *NotesService) Delete(ctx context.Context, id int) (bool, error) {
	ok, err := s.repo.Delete(id)
	if ok {
		s.cache.Del(ctx, noteCacheKey(id))
	}
	return ok, err
}

func (s *NotesService) List(limit, offset int) (model.NotePage, error) {
	return s.repo.List(limit, offset)
}
