package app

import (
	"fmt"
	"os"

	"github.com/jmoiron/sqlx"
	"github.com/redis/go-redis/v9"
	log "github.com/sirupsen/logrus"

	"golang-back/internal/config"
)

type dataSources struct {
	DB    *sqlx.DB
	Cache *redis.Client
}

func initDataSources() (*dataSources, error) {
	log.Printf("Initializing data sources\n")

	log.Printf("Connecting to Postgresql\n")
	db, err := config.NewPostgresDB(config.DBConfig{
		Host:     os.Getenv("POSTGRES_HOST"),
		Port:     os.Getenv("POSTGRES_PORT"),
		Username: os.Getenv("POSTGRES_USER"),
		DBName:   os.Getenv("POSTGRES_DB"),
		Password: os.Getenv("POSTGRES_PASSWORD"),
	})
	if err != nil {
		log.Printf("Failed connecting to Postgres: %v", err)
		return nil, err
	} else {
		log.Printf("Postgres successfully started on host=%s port=%s !!", os.Getenv("POSTGRES_HOST"), os.Getenv("POSTGRES_PORT"))
	}

	log.Printf("Connecting to Redis\n")
	cache, err := config.NewRedisCache(config.CacheConfig{
		Host: os.Getenv("REDIS_HOST"),
		Port: os.Getenv("REDIS_PORT"),
	})
	if err != nil {
		log.Printf("Failed connecting to Redis: %v", err)
		return nil, err
	} else {
		log.Printf("Redis successfully started on host=%s port=%s !!", os.Getenv("REDIS_HOST"), os.Getenv("REDIS_PORT"))
	}

	return &dataSources{
		DB:    db,
		Cache: cache,
	}, nil
}

func (d *dataSources) close() error {
	if err := d.DB.Close(); err != nil {
		return fmt.Errorf("error closing Postgresql: %w", err)
	}

	if err := d.Cache.Close(); err != nil {
		return fmt.Errorf("error closing Redis Client: %w", err)
	}

	return nil
}
