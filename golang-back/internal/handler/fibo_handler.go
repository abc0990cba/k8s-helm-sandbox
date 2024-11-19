package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"golang-back/internal/util"
)

func (h *Handler) getFibonacciSum(c *gin.Context) {
	num, err := strconv.Atoi(c.Param("num"))
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "invalid num param")
		return
	}

	fiboSum, err := h.services.Fibonacci.GetFibonacciSum(c, num)
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, fmt.Sprintf("Something went wrong for calculating sum for num=%d", num))
		return
	}

	c.JSON(http.StatusOK, fiboSum)
}
