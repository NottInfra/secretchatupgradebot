.PHONY: build run test

build:
	@npm run build

run:
	@npm run start

test:
	@npm ci
	@npm run build:sdk
	@npm run test:coverage
