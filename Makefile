.PHONY: docker-lint docker-build docker-test-static docker-test-smoke docker-test-lsp docker-test docker-all

IMAGE_TAG ?= kodizm-agent:dev
SCRIPTS := $(CURDIR)/scripts
FIXTURES := $(CURDIR)/tests/fixtures

docker-lint:
	docker run --rm -i -v $(CURDIR)/.hadolint.yaml:/.config/hadolint.yaml:ro hadolint/hadolint < Dockerfile

docker-build:
	docker build -t $(IMAGE_TAG) .

docker-test-static: docker-build
	container-structure-test test \
		--image $(IMAGE_TAG) \
		--config tests/structure-test.yaml

docker-test-smoke: docker-build
	docker run --rm -v $(SCRIPTS):/smoke:ro $(IMAGE_TAG) bash /smoke/smoke.sh

docker-test-lsp: docker-build
	docker run --rm -v $(SCRIPTS):/smoke:ro -v $(FIXTURES):/fixtures:ro \
		-e LSP_FIXTURES=/fixtures $(IMAGE_TAG) node /smoke/lsp-probe.mjs

docker-test: docker-test-static docker-test-smoke docker-test-lsp

docker-all: docker-lint docker-build docker-test
