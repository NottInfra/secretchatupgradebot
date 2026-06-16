.PHONY: build run test

build:
	@npm run build

run:
	@npm run start

test:
	@npm ci
	@npm run test:coverage
