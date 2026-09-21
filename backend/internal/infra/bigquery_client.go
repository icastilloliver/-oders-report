package infra

import (
	"context"
	"fmt"
	"os"

	"cloud.google.com/go/bigquery"
	"google.golang.org/api/option"
)

type Config struct {
	ProjectID       string // proyecto que factura los jobs
	CredentialsFile string // opcional: ruta al JSON de service account
}

func NewBQClient(ctx context.Context, cfg Config) (*bigquery.Client, error) {
	if cfg.ProjectID == "" {
		return nil, fmt.Errorf("bigquery: ProjectID es obligatorio")
	}

	var opts []option.ClientOption
	if cfg.CredentialsFile != "" {
		if _, err := os.Stat(cfg.CredentialsFile); err != nil {
			return nil, fmt.Errorf("bigquery: no se encontró el archivo de credenciales %q: %w", cfg.CredentialsFile, err)
		}
		opts = append(opts, option.WithCredentialsFile(cfg.CredentialsFile))
	}

	client, err := bigquery.NewClient(ctx, cfg.ProjectID, opts...)
	if err != nil {
		return nil, fmt.Errorf("bigquery: creando cliente: %w", err)
	}

	return client, nil
}
