module example.com/monorepo/pkg2

go 1.21

require (
	example.com/monorepo/pkg1 v0.0.0
	golang.org/x/text v0.12.0
)

replace example.com/monorepo/pkg1 => ../pkg1
