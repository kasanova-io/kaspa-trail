# ABOUTME: Unified Makefile for forensics service — local dev and Docker operations
# ABOUTME: Use `make dev` for bare-metal, `make up` for Docker, ENV=prod for production

.PHONY: help install dev stop build up down restart logs shell status health clean clean-docker deploy full-deploy

# Configuration
ENV ?= local
SERVICE_NAME = forensics
PORT ?= 8010

# Set compose file and project name based on environment
ifeq ($(ENV),local)
    PROJECT_NAME = $(SERVICE_NAME)_local
    COMPOSE_FILE = -p $(PROJECT_NAME) -f docker-compose.yml -f docker-compose.override.yml
    BACKEND_CONTAINER = forensics_backend_local
    FRONTEND_CONTAINER = forensics_frontend_local
endif
ifeq ($(ENV),prod)
    PROJECT_NAME = $(SERVICE_NAME)_prod
    COMPOSE_FILE = -p $(PROJECT_NAME) -f docker-compose.prod.yml
    BACKEND_CONTAINER = forensics_backend_prod
    FRONTEND_CONTAINER = forensics_frontend_prod
endif

ensure-network:  ## Ensure shared network exists (prod only)
ifeq ($(ENV),prod)
	@docker network create caddy_caddy_net 2>/dev/null || true
endif

# Default target
help:  ## Show this help message
	@echo "Kaspa Forensics — Unified Commands"
	@echo ""
	@echo "Usage: make [target] ENV=[local|prod]"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Bare-metal development (no Docker)
install:  ## Install dependencies (bare-metal)
	cd backend && uv sync --all-extras
	cd frontend && npm install

dev:  ## Start backend + frontend (bare-metal, no Docker)
	@cd backend && uv run uvicorn forensics.main:app --reload --port $(PORT) &
	@cd frontend && BACKEND_URL=http://localhost:$(PORT) npm run dev &
	@echo "Backend: http://localhost:$(PORT)"
	@echo "Frontend: http://localhost:3001"

stop:  ## Stop bare-metal dev servers
	-@pkill -f "uvicorn forensics.main:app" 2>/dev/null
	-@pkill -f "next dev" 2>/dev/null

# Docker operations
build:  ## Build Docker images
	docker compose $(COMPOSE_FILE) build

up: ensure-network  ## Start services in Docker
	docker compose $(COMPOSE_FILE) up -d

down:  ## Stop Docker services
	docker compose $(COMPOSE_FILE) down

restart: down up  ## Restart Docker services

logs:  ## View Docker logs
	docker compose $(COMPOSE_FILE) logs -f -n100

logs-backend:  ## View backend logs only
	docker logs -f -n100 $(BACKEND_CONTAINER)

logs-frontend:  ## View frontend logs only
	docker logs -f -n100 $(FRONTEND_CONTAINER)

shell:  ## Open shell in backend container
	docker exec -it $(BACKEND_CONTAINER) /bin/bash

status:  ## Check service status
	@docker ps --filter "name=$(SERVICE_NAME)" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

health:  ## Check backend health endpoint
	@echo "Checking health for $(ENV) environment..."
ifeq ($(ENV),local)
	@curl -sf http://localhost:$(PORT)/api/health | python3 -m json.tool || echo "Not healthy"
else
	@docker exec $(BACKEND_CONTAINER) curl -sf http://localhost:80/api/health || echo "Not healthy"
endif

# Cleanup
clean:  ## Clean build artifacts
	find backend -type f -name "*.pyc" -delete
	find backend -type d -name "__pycache__" -delete
	rm -rf backend/.pytest_cache frontend/.next frontend/node_modules/.cache

clean-docker:  ## Remove Docker images and volumes
	docker compose $(COMPOSE_FILE) down -v --rmi all

# Deployment
deploy: build up health  ## Build, start, and verify health

full-deploy: deploy  ## Alias for deploy
