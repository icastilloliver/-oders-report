package model

// ErrorCodeCount es el conteo de registros marcados como Error para un
// errorCode ya normalizado (ver errorCodeNormSQL en el repositorio).
type ErrorCodeCount struct {
	ErrorCode    string  `json:"errorCode"`
	ErrorMessage *string `json:"errorMessage"`
	Total        int64   `json:"total"`
}

// ErrorCodesResult agrupa el desglose por errorCode y su total, tal como lo
// espera la dona "Composición del % Error por errorCode" del frontend.
type ErrorCodesResult struct {
	Data  []*ErrorCodeCount `json:"data"`
	Total int64             `json:"total"`
}
