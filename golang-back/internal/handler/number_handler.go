package handler

import (
	"net/http"

	"golang-back/internal/model"
	"golang-back/internal/util"

	"github.com/gin-gonic/gin"
)

// POST /numbers {"number": <int>} — creating rows used to hang off
// GET /numbers/:num (the old contract); it is a proper POST now
func (h *Handler) create(c *gin.Context) {
	var input model.NumberInput
	if err := c.ShouldBindJSON(&input); err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "body must be {\"number\": <int>}")
		return
	}

	id, err := h.services.Number.Create(input.Number)
	if err != nil {
		util.NewErrorResponse(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": id, "number": input.Number})
}

func (h *Handler) list(c *gin.Context) {

	fiboSumList, err := h.services.Number.List()

	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	c.JSON(http.StatusOK, fiboSumList)
}
