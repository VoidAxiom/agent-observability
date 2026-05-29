help:
	@echo "target                owner"
	@echo "--------------------  ------------------------"
	@echo "help                  VOI-304 (this packet)"
	@echo "clickhouse-up         VOI-306"
	@echo "clickhouse-down       VOI-306"
	@echo "clickhouse-migrate    VOI-306"
	@echo "collector-up          VOI-307"
	@echo "collector-down        VOI-307"
	@echo "sdk-test              VOI-308"
	@echo "app-build             VOI-309"
	@echo "app-run               VOI-309"
	@echo "app-test              VOI-314"
	@echo "demo                  VOI-310 (M0 acceptance gate)"

.PHONY: help clickhouse-up clickhouse-down clickhouse-migrate collector-up collector-down sdk-test app-build app-run app-test demo

clickhouse-up:
	@test -f .env || cp .env.example .env
	docker compose -f clickhouse/docker-compose.yml --env-file .env up -d --wait

clickhouse-down:
	docker compose -f clickhouse/docker-compose.yml down

clickhouse-migrate:
	bash clickhouse/migrate.sh

collector-up:
	@test -f .env || cp .env.example .env
	docker compose -f collector/docker-compose.yml --env-file .env up -d --wait
	@printf 'waiting for collector health_check extension on 127.0.0.1:13133...\n'
	@i=0; until curl -fsS http://127.0.0.1:13133/ >/dev/null 2>&1; do \
		i=$$((i+1)); \
		if [ $$i -ge 30 ]; then \
			echo "collector health_check did not respond within 30s" >&2; \
			docker compose -f collector/docker-compose.yml logs --tail=50 otel-collector >&2; \
			exit 1; \
		fi; \
		sleep 1; \
	done
	@echo "collector ready (health_check 200)"

collector-down:
	docker compose -f collector/docker-compose.yml down

sdk-test:
	@test -d sdk/.venv || (cd sdk && uv venv --python 3.11 .venv)
	cd sdk && uv pip install -e ".[dev]"
	cd sdk && uv run pytest -q .

app-build:
	cd app && swift build -c release

app-run:
	cd app && swift run -c release AgentObservability

# Run app's Swift Testing suite. Two flag pairs are needed on
# CommandLineTools-only hosts (no Xcode.app):
#   -Xswiftc -F <path>  — lets the compiler find Testing.swiftmodule
#   -Xlinker -rpath -Xlinker <path>  — bakes the runtime search path
#                                       into the test binary so dyld
#                                       can load Testing.framework
# SwiftPM auto-derives an internal runner.swift whose
# `#if canImport(Testing)` gate doesn't see flags scoped to manifest-
# declared targets via Package.swift unsafeFlags, so the recipe carries
# them at the CLI instead. Keeps Package.swift clean.
app-test:
	cd app && swift test \
		-Xswiftc -F -Xswiftc /Library/Developer/CommandLineTools/Library/Developer/Frameworks \
		-Xlinker -rpath -Xlinker /Library/Developer/CommandLineTools/Library/Developer/Frameworks

demo:
	bash scripts/demo-smoke.sh
