package handler

import (
	"time"

	"github.com/gin-gonic/gin"

	"golang-back/internal/middleware"
	"golang-back/internal/util/apperror"
)

// TODO: move to env
const FIBONACCI_MAX_TIMEOUT = time.Second * 10

func (h *Handler) InitRoutes() *gin.Engine {
	router := gin.New()

	router.GET("/healthz", h.health)
	router.GET("/fibonacci/:num",
		middleware.Timeout(FIBONACCI_MAX_TIMEOUT, apperror.NewServiceUnavailable()),
		h.getFibonacciSum,
	)

	numbers := router.Group("/numbers")
	{
		numbers.GET("/", h.list)
		// TODO: make POST
		numbers.GET("/:num", h.create)
		numbers.GET("/primes/:limit", h.getPrimesAmount)
	}

	return router
}
