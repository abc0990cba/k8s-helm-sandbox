package app

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"golang-back/internal/config"
	"golang-back/internal/handler"
	"golang-back/internal/repository"
	"golang-back/internal/service"

	"github.com/joho/godotenv"
	log "github.com/sirupsen/logrus"
)

type App struct{}

func loadEnvs() {
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}
}

func (app *App) Run() {
	loadEnvs()

	db, err := config.NewPostgresDB(config.DBConfig{
		Host:     os.Getenv("POSTGRES_HOST"),
		Port:     os.Getenv("POSTGRES_PORT"),
		Username: os.Getenv("POSTGRES_USER"),
		DBName:   os.Getenv("POSTGRES_DB"),
		Password: os.Getenv("POSTGRES_PASSWORD"),
	})
	if err != nil {
		log.Fatalf("Failed initialization database: %s", err.Error())
	}

	repos := repository.NewRepository(db)
	services := service.NewService(repos)
	handlers := handler.NewHandler(services)

	server := new(Server)
	go func() {
		if err := server.Run(os.Getenv("PORT"), handlers.InitRoutes()); err != nil {
			log.Fatalf("error occured while running http server: %s", err.Error())
		}
	}()

	log.Printf("!! App Started on port=%s !!", os.Getenv("PORT"))

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	log.Print("TodoApp Shutting Down")

	if err := server.Shutdown(context.Background()); err != nil {
		log.Errorf("error occured on server shutting down: %s", err.Error())
	}

	if err := db.Close(); err != nil {
		log.Errorf("error occured on db connection close: %s", err.Error())
	}
}
