package handler

import (
	"github.com/gin-gonic/gin"
)

func (h *Handler) InitRoutes() *gin.Engine {
	router := gin.New()

	router.GET("/healthz", h.health)
	router.GET("/fibonacci/:num", h.getFibonacciSum)
	router.GET("/numbers/:num", h.create)
	router.GET("/numbers", h.list)

	return router
}
