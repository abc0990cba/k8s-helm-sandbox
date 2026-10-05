package handler

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"golang-back/internal/middleware"
	"golang-back/internal/util/apperror"
)

// TODO: move to env
const FIBONACCI_MAX_TIMEOUT = time.Second * 10

func (h *Handler) InitRoutes() *gin.Engine {
	router := gin.New()

	router.GET("/healthz", h.health)
	router.GET("/ready", h.ready)
	// prometheus scrape target (ServiceMonitor when metrics are enabled)
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))
	router.GET("/fibonacci/:num",
		middleware.Timeout(FIBONACCI_MAX_TIMEOUT, apperror.NewServiceUnavailable()),
		h.getFibonacciSum,
	)
	router.GET("/primes/:limit", h.getPrimesAmount)

	numbers := router.Group("/numbers")
	{
		numbers.GET("/", h.list)
		numbers.POST("/", h.create)
	}

	// the same REST contract the nodejs backend implements — one API, two stacks
	notes := router.Group("/notes")
	{
		notes.GET("/", h.listNotes)
		notes.POST("/", h.createNote)
		notes.GET("/:id", h.getNote)
		notes.PATCH("/:id", h.patchNote)
		notes.DELETE("/:id", h.deleteNote)
	}

	return router
}
