# Etapa 1: Construir el Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Etapa 2: Compilar el backend (Go)
FROM golang:1.23-alpine AS backend-builder
# go.mod pide una versión de toolchain más nueva que la de esta imagen base;
# con GOTOOLCHAIN=auto, `go` la descarga sola en build time en vez de fallar.
ENV GOTOOLCHAIN=auto
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/api

# Etapa 3: Runtime — un solo binario Go que expone /api/* y sirve el
# frontend ya compilado (ver internal/transport/static.go). Ya no hay
# proceso Node en producción.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend-builder /app/server ./server
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV STATIC_DIR=/app/frontend/dist

EXPOSE 8080
CMD ["./server"]
