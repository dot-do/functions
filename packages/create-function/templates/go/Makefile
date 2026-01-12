.PHONY: build dev deploy

build:
	go run github.com/syumai/workers/cmd/workers-assets-gen@latest
	tinygo build -o ./build/app.wasm -target wasm -no-debug ./main.go

dev:
	wrangler dev

deploy:
	wrangler deploy
