module example.com/app

go 1.21

require (
	github.com/google/uuid v1.3.0
	example.com/internal/utils v0.0.0
)

replace example.com/internal/utils => ./internal/utils

require (
	golang.org/x/text v0.12.0 // indirect
)
