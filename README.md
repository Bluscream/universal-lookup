# Universal Lookup

A universal lookup service that aggregates multiple APIs for phone, IP, email, location, and parcel lookups — with smart caching, response merging, and a modern web interface.

## Features

- **5 Lookup Types**: Phone (tel), IP/Domain, Email, Location, Parcel tracking
- **Smart Merging**: Automatically merges responses from multiple providers, normalizing field names
- **SQLite Caching**: Long-term caching with configurable TTL per lookup type
- **OpenAPI Documentation**: Fully featured Swagger UI at `/docs`
- **Modern Frontend**: Premium dark-themed UI with real-time lookups
- **Docker Ready**: Multi-stage Dockerfile with Puppeteer/Chromium support
- **Unraid Compatible**: Includes Community Applications template

## Lookup Types & Providers

| Type | Providers |
|------|-----------|
| **Phone** (`/api/tel/:query`) | Tellows, Das Telefonbuch, 11880, Das Örtliche, FritzBox |
| **IP/Domain** (`/api/ip/:query`) | ip-api.com, ip-api.io, MaxMind GeoLite2, WHOIS, DNS, Ping, Subdomains |
| **Email** (`/api/email/:query`) | ip-api.io (validation, advanced validation, risk score) |
| **Location** (`/api/location/:query`) | OpenStreetMap Nominatim, Google Maps |
| **Parcel** (`/api/parcel/:query`) | ParcelsApp |

## Quick Start

```bash
# Clone
git clone https://github.com/Bluscream/universal-lookup.git
cd universal-lookup

# Configure
cp .env.example .env
# Edit .env with your API keys

# Install & run
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the web UI, or [http://localhost:3000/docs](http://localhost:3000/docs) for API docs.

## API Usage

```bash
# IP lookup
curl http://localhost:3000/api/ip/8.8.8.8

# Phone lookup
curl http://localhost:3000/api/tel/+493012345678

# Email lookup
curl http://localhost:3000/api/email/user@example.com

# Location lookup
curl http://localhost:3000/api/location/Berlin,Germany

# Parcel tracking
curl http://localhost:3000/api/parcel/00340434515310596216

# With raw responses
curl http://localhost:3000/api/ip/8.8.8.8?raw=true

# Force fresh (bypass cache)
curl http://localhost:3000/api/ip/8.8.8.8?fresh=true

# Shortcut routes (without /api prefix)
curl http://localhost:3000/ip/8.8.8.8
```

## Response Format

```json
{
  "lookup_time": "234ms",
  "success": true,
  "response": {
    "country": "United States",
    "country_code": "US",
    "city": "Mountain View",
    "...": "..."
  },
  "errors": {},
  "raw": {},
  "request": {
    "time": "2026-05-06T13:00:00Z",
    "ip": "192.168.1.1",
    "type": "ip",
    "query": "8.8.8.8"
  }
}
```

## Docker

```bash
cd docker
docker compose up --build
```

## Environment Variables

See [`.env.example`](.env.example) for all available configuration options.

## License

MIT
