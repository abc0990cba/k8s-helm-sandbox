package app

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	log "github.com/sirupsen/logrus"

	"golang-back/internal/handler"
	"golang-back/internal/repository"
	"golang-back/internal/service"
)

type App struct{}

func loadEnvs() {
	// .env is a local-dev convenience only; in the cluster real config comes
	// from pod env (the old log.Fatal here forced the Dockerfile to fake a .env)
	if err := godotenv.Load(); err != nil {
		log.Info("no .env file — using environment (expected in cluster)")
	}
}

func (app *App) Run() {
	log.Println("Starting server...")

	loadEnvs()

	ds, err := initDataSources()
	if err != nil {
		log.Fatalf("Unable to initialize data sources: %v\n", err)
	}

	repos := repository.NewRepository(ds.DB)
	services := service.NewService(repos, ds.Cache)
	handlers := handler.NewHandler(services)

	server := new(Server)
	go func() {
		if err := server.Run(os.Getenv("PORT"), handlers.InitRoutes()); err != nil {
			log.Fatalf("Error occurred while running http server: %s", err.Error())
		}
	}()

	log.Printf("!! App Started on port=%s !!", os.Getenv("PORT"))

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	log.Print("App Shutting Down")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := ds.close(); err != nil {
		log.Fatalf("A problem occurred gracefully shutting down data sources: %v\n", err)
	}

	if err := server.Shutdown(ctx); err != nil {
		log.Errorf("Error occurred on server shutting down: %s", err.Error())
	}
}
