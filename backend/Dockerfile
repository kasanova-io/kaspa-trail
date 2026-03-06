# ABOUTME: Multi-stage Dockerfile for Kaspa forensics FastAPI backend using uv
# ABOUTME: Optimized for production deployment with security best practices

# Build stage - install dependencies
FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/

ENV VIRTUAL_ENV=/opt/venv
RUN uv venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

RUN uv pip install --no-cache .

# Development stage
FROM python:3.13-slim AS dev

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml ./
RUN uv sync

COPY src/ ./src/

ENV VIRTUAL_ENV=/app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8010

CMD ["uvicorn", "forensics.main:app", "--host", "0.0.0.0", "--port", "8010", "--reload"]

# Production stage
FROM python:3.13-slim AS prod

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN addgroup --system --gid 1001 forensics && \
    adduser --system --uid 1001 --ingroup forensics forensics

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/

USER forensics

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/api/health || exit 1

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "forensics.main:app", "--host", "0.0.0.0", "--port", "80"]
