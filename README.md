# 🔍 Universal Lookup

[![npm version](https://img.shields.io/npm/v/universal-lookup.svg)](https://www.npmjs.com/package/universal-lookup)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker Image Version](https://img.shields.io/docker/v/bluscream1/universal-lookup?label=docker)](https://hub.docker.com/r/bluscream1/universal-lookup)
[![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64%20%7C%20armv7%20%7C%20x86-blue)](https://github.com/Bluscream/universal-lookup)

**Universal Lookup** is a high-performance intelligence service that aggregates multiple APIs for phone numbers, IP addresses, emails, locations, and parcels. It features smart response merging, multi-layered caching, and a premium web interface.

---

## 🌟 Features

- **🚀 Instant Execution**: Run via `npx` without any setup.
- **🔄 Multi-Provider Aggregation**: Merges results from dozens of sources (Tellows, MaxMind, Google, etc.).
- **📦 Multi-Arch Docker**: Native support for **ARM64 (Apple Silicon), ARMv7 (RPi), AMD64, and x86**.
- **⚡ Smart Caching**: Persistent SQLite storage with configurable TTL per data type.
- **🎨 Premium UI**: Modern dark-mode web interface for real-time lookups.
- **📖 OpenAPI 3.0**: Fully documented REST API with Swagger UI.
- **🏠 Unraid Ready**: Optimized for Unraid with Community Applications templates.

---

## 🚀 Quick Start

### 1. Using npx (Recommended)
Run the server instantly from any terminal:
```bash
npx universal-lookup
```
*Note: Ensure you have Node.js 20+ installed.*

### 2. Using Docker
Pull the multi-arch image from GitHub or Docker Hub:
```bash
# Using Docker Hub
docker run -d -p 24010:24010 --name lookup bluscream1/universal-lookup:latest

# Using GHCR
docker run -d -p 24010:24010 --name lookup ghcr.io/bluscream/universal-lookup:latest
```

### 3. Manual Installation
```bash
git clone https://github.com/Bluscream/universal-lookup.git
cd universal-lookup
npm install
npm run build
npm start
```

---

## 📡 API Endpoints

All endpoints are available at `http://localhost:24010/api/*`.

| Endpoint | Description | Example Query |
|----------|-------------|---------------|
| `GET /api/tel/:query` | Reverse phone lookup | `+493012345678` |
| `GET /api/ip/:query` | IP/Domain intelligence | `8.8.8.8` |
| `GET /api/email/:query` | Email validation & risk | `user@example.com` |
| `GET /api/location/:query` | Geocoding & Reverse Geocoding | `Berlin, Germany` |
| `GET /api/parcel/:query` | Package tracking | `00340434515310596216` |

> 📖 **Full Documentation**: Explore the interactive Swagger UI at [http://localhost:24010/docs](http://localhost:24010/docs).

---

## ⚙️ Configuration

Copy `.env.example` to `.env` to customize the service.

### Server & Security
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `24010` | Server port |
| `HOST` | `0.0.0.0` | Binding address |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `REQUIRE_TOKEN` | `null` | If set, requires `?token=` for all API calls |
| `RATE_LIMIT_MAX` | `100` | Max requests per time window |
| `RATE_LIMIT_WINDOW`| `1 minute` | Rate limit time window |

### Cache & Performance
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `./data/cache.db` | Path to SQLite database |
| `CACHE_TTL` | `86400` | Default cache duration (seconds) |
| `CACHE_TTL_PARCEL`| `3600` | Cache duration for parcels (seconds) |
| `PROVIDER_TIMEOUT` | `10000` | Max wait time for API providers (ms) |
| `PUPPETEER_TIMEOUT`| `15000` | Max wait time for headless browser (ms) |

### API Keys (Optional)
| Variable | Description |
|----------|-------------|
| `IP_API_COM_KEY` | Commercial key for ip-api.com |
| `IP_API_IO_KEY` | API key for ip-api.io features |
| `TELLOWS_API_KEY` | Partner key for Tellows |
| `MAXMIND_LICENSE_KEY` | License for GeoLite2 downloads |
| `GOOGLE_MAPS_API_KEY` | Key for Geocoding API |
| `PARCELSAPP_API_KEY` | Key for ParcelsApp tracking |
| `DHL_API_KEY` | Key for official DHL API |

### Integration Settings
| Variable | Default | Description |
|----------|---------|-------------|
| `FRITZBOX_HOST` | `fritz.box` | FritzBox address for phone lookups |
| `PHONE_COUNTRY_PREFIX`| `0049` | Default country code |
| `PHONE_LOCAL_PREFIX`| `null` | Default local area code |
| `UNIVERSAL_RESULTS_LIMIT`| `3` | Max results shown per provider |
| `PUPPETEER_SKIP_DOWNLOAD`| `false` | Skip downloading Chromium |

---

## 🛠️ Development & Deployment

The project includes a robust automation script for contributors:

```powershell
# Run QA, bump version, push to Git, build Docker (all archs), and publish to npm
.\scripts\update.ps1 -Bump patch
```

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

### Credits & Contributions
- **Lead Developer**: [Bluscream](https://github.com/Bluscream)
- **AI Coding Assistant**: [Antigravity](https://gemini.google.com/advanced) (Google DeepMind)

---

> [!NOTE]
> **AI Disclaimer**: Parts of this codebase, including core logic, documentation, and deployment scripts, were generated or optimized using Advanced Agentic AI. While thoroughly tested, users are encouraged to review critical components for their specific use cases.
