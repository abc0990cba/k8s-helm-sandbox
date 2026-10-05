package handler

import (
	"net/http"
	"strconv"

	"golang-back/internal/model"
	"golang-back/internal/util"

	"github.com/gin-gonic/gin"
)

func (h *Handler) createNote(c *gin.Context) {
	var input model.NoteInput
	if err := c.ShouldBindJSON(&input); err != nil || input.Title == nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "body must be {\"title\": \"...\", \"body\": \"...\"}")
		return
	}

	note := model.NoteModel{
		Title: *input.Title,
		Body:  stringValue(input.Body),
		Owner: util.OwnerFromAuthorization(c.GetHeader("Authorization")),
	}

	id, err := h.services.Notes.Create(&note)
	if err != nil {
		util.NewErrorResponse(c, http.StatusInternalServerError, err.Error())
		return
	}

	created, err := h.services.Notes.Get(c.Request.Context(), id)
	if err != nil {
		util.NewErrorResponse(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.JSON(http.StatusCreated, created)
}

func (h *Handler) listNotes(c *gin.Context) {
	limit := clampInt(parseIntOr(c.Query("limit"), 20), 1, 100)
	offset := max(parseIntOr(c.Query("offset"), 0), 0)

	page, err := h.services.Notes.List(limit, offset)
	if err != nil {
		util.NewErrorResponse(c, http.StatusInternalServerError, err.Error())
		return
	}

	c.JSON(http.StatusOK, page)
}

func (h *Handler) getNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "invalid id")
		return
	}

	note, err := h.services.Notes.Get(c.Request.Context(), id)
	if err != nil {
		util.NewErrorResponse(c, http.StatusNotFound, "note not found")
		return
	}

	c.Header("X-Cache", "see-redis")
	c.JSON(http.StatusOK, note)
}

func (h *Handler) patchNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "invalid id")
		return
	}

	var patch model.NotePatch
	if err := c.ShouldBindJSON(&patch); err != nil || (patch.Title == nil && patch.Body == nil) {
		util.NewErrorResponse(c, http.StatusBadRequest, "provide title and/or body")
		return
	}

	note, err := h.services.Notes.Update(c.Request.Context(), id, patch.Title, patch.Body)
	if err != nil {
		util.NewErrorResponse(c, http.StatusNotFound, "note not found")
		return
	}

	c.JSON(http.StatusOK, note)
}

func (h *Handler) deleteNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		util.NewErrorResponse(c, http.StatusBadRequest, "invalid id")
		return
	}

	ok, err := h.services.Notes.Delete(c.Request.Context(), id)
	if err != nil {
		util.NewErrorResponse(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		util.NewErrorResponse(c, http.StatusNotFound, "note not found")
		return
	}

	c.Status(http.StatusNoContent)
}

func parseIntOr(s string, fallback int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return fallback
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func stringValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
