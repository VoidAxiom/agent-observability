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
	@echo "demo                  VOI-310 (M0 acceptance gate)"

.PHONY: help clickhouse-up clickhouse-down clickhouse-migrate collector-up collector-down sdk-test app-build app-run demo

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

demo:
	@echo "TODO: VOI-310 implements this — see https://linear.app/voidaxiom/issue/VOI-310"
