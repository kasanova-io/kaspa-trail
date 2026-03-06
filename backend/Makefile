# ABOUTME: Backend Makefile for Kaspa forensics API.
# ABOUTME: Provides install, dev, test, lint, and format targets.

PORT ?= 8010

.PHONY: install dev test lint format quick-check

install:
	uv sync --all-extras

dev:
	uv run uvicorn forensics.main:app --reload --port $(PORT)

test:
	uv run pytest -vvs

lint:
	uv run ruff check src/ tests/
	uv run ruff format --check src/ tests/

format:
	uv run ruff format src/ tests/
	uv run ruff check --fix src/ tests/

quick-check: format test
