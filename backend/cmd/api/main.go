package main

import (
	"context"
	"edd-panel-backend/internal/infra"
	"edd-panel-backend/internal/middlewares"
	"edd-panel-backend/internal/repository"
	"edd-panel-backend/internal/services"
	"edd-panel-backend/internal/transport"
	"edd-panel-backend/pkg/utils"
	"fmt"
	"net/http"
	"os"
	_ "time/tzdata" // embebe la base de timezones para que LoadLocation funcione sin tzdata del SO

	"github.com/joho/godotenv"
)

func main() {

	if err := godotenv.Load(); err != nil {
		fmt.Println("aviso: no se pudo cargar .env:", err)
	}

	ctx := context.Background()

	client, err := infra.NewBQClient(ctx, infra.Config{
		ProjectID:       os.Getenv("GCP_PROJECT_ID"),
		CredentialsFile: os.Getenv("GCP_CREDENTIALS_FILE"),
	})
	if err != nil {
		utils.Logging("ERROR", "Error creating BigQuery client", "main", err.Error())
		return
	}

	defer client.Close()

	ordersRepository := repository.NewOrdersRepository(client)
	ordersService := services.NewOrdersService(ordersRepository)
	ordersHandler := transport.NewOrdersHandler(ordersService)

	http.HandleFunc("/api/orders-decomm", ordersHandler.HandlerOrdersSummary)
	http.HandleFunc("/api/orders-recalculate", ordersHandler.HandlerRecalculateOrders)
	http.HandleFunc("/api/delivery-types", ordersHandler.HandlerDeliveryTypes)
	http.HandleFunc("/api/order-search", ordersHandler.HandlerOrderSearch)
	http.HandleFunc("/api/orders-csv", ordersHandler.HandlerOrdersCSV)
	http.HandleFunc("/api/error-codes", ordersHandler.HandlerErrorCodes)
	http.HandleFunc("/api/orders-bulk-check", ordersHandler.HandlerOrdersBulkCheck)
	http.HandleFunc("/api/error-codes-csv", ordersHandler.HandlerErrorCodesCSV)
	http.HandleFunc("/api/error-trend", ordersHandler.HandlerErrorTrend)
	http.HandleFunc("/api/error-codes-fulfillment", ordersHandler.HandlerErrorCodesFulfillment)
	http.HandleFunc("/api/atp-decomm-rows", ordersHandler.HandlerAtpDecommRows)
	http.HandleFunc("/api/atp-validate", ordersHandler.HandlerAtpValidate)

	// Sirve el build del frontend (y su fallback a index.html) para
	// cualquier ruta que no sea /api/*. En Cloud Run, el binario Go es lo
	// único que corre en el contenedor: ya no hay un Express aparte
	// haciendo express.static.
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "./frontend/dist"
	}
	http.Handle("/", transport.NewStaticHandler(staticDir))

	stackMiddlewares := middlewares.CreateStack(
		middlewares.CorsMiddleware,
		middlewares.RequestInterceptor,
		middlewares.GzipMiddleware,
	)

	// Cloud Run inyecta PORT en runtime (default 8080); en local dev cae a
	// 8080, el mismo puerto al que vite.config.js ya le hace proxy.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	utils.Logging("INFO", fmt.Sprintf("Starting server on :%s", port), "main", nil)
	if err := http.ListenAndServe(":"+port, stackMiddlewares(http.DefaultServeMux)); err != nil {
		utils.Logging("ERROR", "Error starting server", "main", err.Error())
		return
	}
}
