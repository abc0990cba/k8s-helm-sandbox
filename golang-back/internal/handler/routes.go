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
	router.GET("/numbers/:num", h.create)
	router.GET("/numbers", h.list)

	return router
}
