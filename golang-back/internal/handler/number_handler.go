package handler

import (
	"net/http"
	"strconv"

	"golang-back/internal/util"

	"github.com/gin-gonic/gin"
)

func (h *Handler) create(c *gin.Context) {
	num, err := strconv.Atoi(c.Param("num"))
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "invalid num param")
		return
	}

	fiboSum, err := h.services.Number.Create(num)
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	c.JSON(http.StatusOK, fiboSum)
}

func (h *Handler) list(c *gin.Context) {

	fiboSumList, err := h.services.Number.List()

	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	c.JSON(http.StatusOK, fiboSumList)
}
