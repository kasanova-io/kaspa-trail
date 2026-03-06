# Kaspa Forensics

Interactive address graph explorer for the Kaspa blockchain. Paste an address (or `.kas` domain), and visualize all addresses it has interacted with — fund flows, transaction details, entity identification, and on-chain holdings.

![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Address graph visualization** — Interactive force-directed graph (Cytoscape.js + fCoSE) showing fund flows between addresses
- **Directional edge coloring** — Green for incoming, red for outgoing, gray for third-party flows
- **Address type differentiation** — P2PK (circles) vs P2SH/script (diamonds) addresses
- **Entity identification** — Known exchange/service names from the Kaspa API + KNS primary domain resolution
- **Node expansion** — Click any node to expand its transaction graph into the existing view
- **Address inspection** — Balance, transaction count, age, first/last transaction timestamps
- **KNS domain support** — Search by `.kas` domain name, view primary domains and domain holdings
- **KRC20 token holdings** — View token balances from the Kasplex API
- **Transaction list** — Scrollable TX list with direction badges, timestamps, and explorer links
- **Legend filtering** — Click legend items to highlight specific node/edge types
- **URL-based navigation** — Hash-based routing with browser back/forward support

## Architecture

```
┌─────────────────────────┐     ┌──────────────────────────┐
│  Next.js Frontend       │────▶│  FastAPI Backend          │
│  (Cytoscape.js graph)   │     │  (API aggregation)       │
│  localhost:3000          │     │  localhost:8010           │
└─────────────────────────┘     └─────┬──────┬──────┬──────┘
                                      │      │      │
                                      ▼      ▼      ▼
                                  Kaspa    KNS    Kasplex
                                  API      API    API
```

The backend aggregates data from three external APIs and builds the address interaction graph. The frontend renders it with Cytoscape.js using the fCoSE force-directed layout.

## Quick Start

### Prerequisites

- Python 3.13+ with [uv](https://docs.astral.sh/uv/)
- Node.js 18+

### Install

```bash
make install
```

### Run

```bash
make dev
```

This starts both servers:
- Frontend: http://localhost:3000
- Backend: http://localhost:8010

### Stop

```bash
make stop
```

## Development

### Backend

```bash
cd backend
make dev          # Start API server with hot reload
make test         # Run tests
make lint         # Check linting
make format       # Auto-format code
make quick-check  # Format + test
```

### Frontend

```bash
cd frontend
npm run dev       # Start dev server
npm run build     # Production build
npm run lint      # ESLint
```

## Configuration

All configuration is via environment variables with sensible defaults:

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `KASPA_API_URL` | `https://api.kaspa.org` | Kaspa REST API base URL |
| `KNS_API_URL` | `https://api.knsdomains.org/mainnet` | KNS domain API base URL |
| `KASPLEX_API_URL` | `https://api.kasplex.org` | Kasplex KRC20 API base URL |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | Comma-separated allowed origins |
| `REQUEST_TIMEOUT` | `30.0` | HTTP client timeout in seconds |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_URL` | `http://localhost:8010` | Backend API URL for the Next.js proxy |

### Makefile

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8010` | Backend server port |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/address/{address}/graph` | Build address interaction graph |
| `GET` | `/api/address/{address}/info` | Basic address info (balance, tx count) |
| `GET` | `/api/address/{address}/details` | Full details (balance, timestamps, domains, tokens) |
| `GET` | `/api/resolve/{domain}` | Resolve `.kas` domain to address |

## Tech Stack

- **Backend**: Python 3.13, FastAPI, httpx, Pydantic
- **Frontend**: Next.js 15, React 19, Cytoscape.js, Tailwind CSS 4
- **Graph layout**: cytoscape-fcose (force-directed)
- **External APIs**: [api.kaspa.org](https://api.kaspa.org), [api.knsdomains.org](https://api.knsdomains.org), [api.kasplex.org](https://api.kasplex.org)

## License

[MIT](LICENSE)
