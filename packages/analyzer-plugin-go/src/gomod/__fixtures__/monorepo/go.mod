module example.com/monorepo

go 1.21

require (
	example.com/monorepo/pkg1 v0.0.0
	example.com/monorepo/pkg2 v0.0.0
	github.com/stretchr/testify v1.8.4
)

replace (
	example.com/monorepo/pkg1 => ./pkg1
	example.com/monorepo/pkg2 => ./pkg2
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)
