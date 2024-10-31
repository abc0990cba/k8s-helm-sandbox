package util

import (
	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

type errorResponse struct {
	Message string `json:"message"`
}

type statusResponse struct {
	Status string `json:"status"`
}

func NewErrorResponse(context *gin.Context, statusCode int, message string) {
	logrus.Error(message)

	context.AbortWithStatusJSON(statusCode, errorResponse{message})
}
