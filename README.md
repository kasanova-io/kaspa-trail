# Kaspa Forensics

Interactive address graph explorer for the Kaspa blockchain. Paste an address (or `.kas` domain), and visualize all addresses it has interacted with — fund flows, transaction details, entity identification, and on-chain holdings.

## [LIVE DEMO](https://forensics.kasanova.app)

![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Address graph visualization** — Interactive force-directed graph (D3.js) showing fund flows between addresses
- **Protocol detection** — Classifies transactions by protocol: KAS, KRC20, KNS, KRC721, Kasia
- **Protocol filtering** — Filter both the graph and transaction list by protocol type
- **Balance-scaled nodes** — Node size reflects KAS holdings (logarithmic scale)
- **Directional edge coloring** — Green for incoming, red for outgoing, gray for third-party flows
- **Address type differentiation** — P2PK (circles) vs P2SH/script (diamonds) addresses
- **Entity identification** — Known exchange/service names from the Kaspa API + KNS primary domain resolution
- **Node expansion** — Click any node to load its connections into the existing graph
- **Address inspection** — Balance, transaction count, age, first/last transaction timestamps
- **KNS domain support** — Search by `.kas` domain name, view primary domains and domain holdings
- **KRC20 token holdings** — View token balances from the Kasplex API
- **Transaction list** — Scrollable TX list with protocol badges, timestamps, and explorer links
- **Minimap** — Live overview with viewport indicator, updates during simulation
- **Pattern detection** — Identifies peel chains, fan-out, fan-in, and consolidation patterns
- **Time animation** — Replay transaction history with a time slider
- **Path highlighting** — Find shortest paths between addresses
- **Multiple layouts** — Force-directed, radial, and hierarchical options
- **Export** — SVG and PNG graph export
- **Legend filtering** — Click legend items to highlight specific node/edge types
- **URL-based navigation** — Hash-based routing with browser back/forward support
- **Transaction caching** — In-memory TTL cache for immutable blockchain data

## Architecture

```
┌─────────────────────────┐     ┌──────────────────────────┐
│  Next.js Frontend       │────>│  FastAPI Backend          │
│  (D3.js force graph)    │     │  (API aggregation)       │
│  localhost:3001          │     │  localhost:8010           │
└─────────────────────────┘     └─────┬──────┬──────┬──────┘
                                      │      │      │
                                      v      v      v
                                  Kaspa    KNS    Kasplex
                                  API      API    API
```

The backend aggregates data from three external APIs, detects protocols via script analysis and payload inspection, and builds the address interaction graph. The frontend renders it with D3.js force simulation.

### Caching

| Data | TTL | Rationale |
|------|-----|-----------|
| Transactions | 1 hour | Confirmed transactions are immutable on-chain |
| KRC20 operations | 5 min | New ops may appear for active addresses |
| Historical prices | 1 hour | Historical prices don't change |
| Current price | 60 sec | Refreshed frequently for accuracy |

### Protocol Detection

Transactions are classified using a priority chain:

1. **KRC20 oplist** — Kasplex API returns `{reveal_tx: "krc20:op:tick"}`
2. **Script analysis** — P2SH redeem scripts scanned for `OP_FALSE OP_IF` followed by protocol markers (`kasplex`, `kns`, `krc721`, `kspr`)
3. **Kasia payload** — Transaction `payload` field checked for `ciph_msg:1:` hex prefix
4. **Fee heuristics** — P2SH commit patterns with round KAS amounts (KNS/KRC20 fees)
5. **Default** — Plain KAS transfer

## Quick Start

### Prerequisites

- Python 3.13+ with [uv](https://docs.astral.sh/uv/)
- Node.js 22+

### Install

```bash
make install
```

### Run (bare-metal)

```bash
make dev
```

This starts both servers:
- Frontend: http://localhost:3001
- Backend: http://localhost:8010

### Run (Docker)

```bash
make up               # Local development with hot reload
make up ENV=prod      # Production deployment
```

### Stop

```bash
make stop             # Bare-metal
make down             # Docker
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

### Docker Commands

```bash
make build            # Build images
make up               # Start (local dev, ports 8010 + 3001)
make up ENV=prod      # Start (production, behind reverse proxy)
make down             # Stop
make restart          # Restart
make logs             # All logs
make logs-backend     # Backend logs only
make logs-frontend    # Frontend logs only
make status           # Container status
make health           # Health check
make deploy ENV=prod  # Build + start + health check
make clean-docker     # Remove images and volumes
```

## Configuration

All configuration is via environment variables with sensible defaults:

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `KASPA_API_URL` | `https://api.kaspa.org` | Kaspa REST API base URL |
| `KNS_API_URL` | `https://api.knsdomains.org/mainnet` | KNS domain API base URL |
| `KASPLEX_API_URL` | `https://api.kasplex.org` | Kasplex KRC20 API base URL |
| `COINGECKO_API_URL` | `https://api.coingecko.com/api/v3` | CoinGecko price API base URL |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | Comma-separated allowed origins |
| `REQUEST_TIMEOUT` | `30.0` | HTTP client timeout in seconds |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_URL` | `http://localhost:8010` | Backend API URL for the Next.js proxy |

### Makefile

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8010` | Backend server port (bare-metal) |
| `ENV` | `local` | Environment: `local` or `prod` |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/address/{address}/graph?tx_limit=100&tx_offset=0` | Build address interaction graph |
| `GET` | `/api/address/{address}/info` | Basic address info (balance, tx count) |
| `GET` | `/api/address/{address}/details` | Full details (balance, timestamps, domains, tokens) |
| `GET` | `/api/resolve/{domain}` | Resolve `.kas` domain to address |
| `GET` | `/api/price/range?from_ts=&to_ts=` | Historical KAS/USD prices |
| `GET` | `/api/price/current` | Current KAS/USD price |

## Tech Stack

- **Backend**: Python 3.13, FastAPI, httpx, Pydantic
- **Frontend**: Next.js 15, React 19, D3.js, Tailwind CSS 4
- **Graph**: D3.js force simulation with zoom, drag, and multiple layouts
- **External APIs**: [api.kaspa.org](https://api.kaspa.org), [api.knsdomains.org](https://api.knsdomains.org), [api.kasplex.org](https://api.kasplex.org), [CoinGecko](https://api.coingecko.com)
- **Deployment**: Multi-stage Docker, Docker Compose (local + production)

## License

[MIT](LICENSE)
