package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) health(c *gin.Context) {
	c.JSON(http.StatusOK, "health")
}

// readiness for the chart probe — the process is up; data-source waits happen
// in the init containers before this ever starts
func (h *Handler) ready(c *gin.Context) {
	c.JSON(http.StatusOK, "ready")
}
