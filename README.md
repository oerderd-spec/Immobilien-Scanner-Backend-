# ZVG Multi-Portal Immobilien Scanner Backend

Backend-Server für die Aggregation von Immobilienanzeigen aus mehreren deutschen Portalen.

## Unterstützte Portale

- ⚖️ **ZVG** - Zwangsversteigerungen (21 Amtsgerichte NRW)
- 🏠 **Scout24** - ImmobilienScout24 Kaufimmobilien
- 🌍 **Immowelt** - Immowelt Kaufimmobilien
- 📦 **Kleinanzeigen** - eBay Kleinanzeigen Immobilien

## Features

- Puppeteer-basiertes Scraping für moderne JavaScript-Seiten
- PDF-Parsing für ZVG-Gutachten
- CORS-Proxy für Frontend-Requests
- Stealth-Mode gegen Bot-Detection
- Debug-Modus mit Screenshots & HTML-Dumps

## API Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/health` | GET | Server-Status |
| `/api/proxy` | GET | CORS-Proxy für alle Portale |
| `/api/parse-pdf` | POST | Gutachten-PDF parsen |

## Deployment auf Railway

1. Repository mit Railway verbinden
2. Railway erkennt automatisch Node.js
3. Environment Variables werden automatisch gesetzt (PORT)
4. Chromium wird über nixpacks.toml installiert

## Technologie

- **Node.js** + Express
- **Puppeteer** für Browser-Automation
- **Cheerio** für HTML-Parsing
- **pdf-parse** für PDF-Extraktion
- **Axios** für HTTP-Requests

## Lokale Entwicklung

```bash
npm install
npm start
# Server läuft auf http://localhost:3001
```

## Autor

Daniel Nippes - ZVG Scanner App
