package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"golang-back/internal/util"
)

func (h *Handler) getPrimesAmount(c *gin.Context) {
	limit, err := strconv.Atoi(c.Param("limit"))
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "invalid limit param")
		return
	}

	isParallel := c.Query("parallel") == "true"

	workersNum := 1
	if isParallel {
		workersNum = 4
	}

	primesAmount, err := h.services.GetPrimesAmount(c, workersNum, limit)
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, fmt.Sprintf("Something went wrong for calculating primes for num=%d", primesAmount))
		return
	}

	c.JSON(http.StatusOK, primesAmount)
}
