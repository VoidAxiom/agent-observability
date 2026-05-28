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
	@echo "TODO: VOI-306 implements this — see https://linear.app/voidaxiom/issue/VOI-306"

clickhouse-down:
	@echo "TODO: VOI-306 implements this — see https://linear.app/voidaxiom/issue/VOI-306"

clickhouse-migrate:
	@echo "TODO: VOI-306 implements this — see https://linear.app/voidaxiom/issue/VOI-306"

collector-up:
	@echo "TODO: VOI-307 implements this — see https://linear.app/voidaxiom/issue/VOI-307"

collector-down:
	@echo "TODO: VOI-307 implements this — see https://linear.app/voidaxiom/issue/VOI-307"

sdk-test:
	@echo "TODO: VOI-308 implements this — see https://linear.app/voidaxiom/issue/VOI-308"

app-build:
	@echo "TODO: VOI-309 implements this — see https://linear.app/voidaxiom/issue/VOI-309"

app-run:
	@echo "TODO: VOI-309 implements this — see https://linear.app/voidaxiom/issue/VOI-309"

demo:
	@echo "TODO: VOI-310 implements this — see https://linear.app/voidaxiom/issue/VOI-310"
