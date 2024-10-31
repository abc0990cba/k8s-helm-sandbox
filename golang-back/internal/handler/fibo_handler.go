package handler

import (
	"net/http"
	"strconv"

	"golang-back/internal/util"

	"github.com/gin-gonic/gin"
)

func (h *Handler) getFibonacciSum(c *gin.Context) {
	num, err := strconv.Atoi(c.Param("num"))
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "invalid num param")
		return
	}

	fiboSum := h.services.Fibonacci.GetFibonacciSum(num)

	c.JSON(http.StatusOK, fiboSum)
}
