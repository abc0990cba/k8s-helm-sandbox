package config

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

type CacheConfig struct {
	Host string
	Port string
}

func NewRedisCache(cfg CacheConfig) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.Host, cfg.Port),
		Password: "",
		DB:       0,
	})

	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, err
	}

	return client, nil
}
