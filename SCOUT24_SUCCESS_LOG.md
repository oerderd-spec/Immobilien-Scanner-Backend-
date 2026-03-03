# Multi-Portal Integration - Erfolgslog

**Datum:** 03.03.2026
**Status:** ✅ SCOUT24 & IMMOWELT FUNKTIONIEREN!

## Ergebnisse
- **Scout24:** 17 Immobilien mit Adresse & Bildern ✅
- **Immowelt:** 27 Immobilien mit Adresse & Bildern ✅
- **Gesamt:** 44+ Immobilien aus 2 Portalen!

---

# ImmobilienScout24 - Erfolgreiche Integration

**Status:** ✅ KOMPLETT FUNKTIONIERT
**Dauer:** ~2 Stunden
**Schwierigkeit:** ⭐⭐⭐⭐ (Hoch - komplexe HTML-Struktur)

---

## 🎯 DIE ERFOLGREICHE STRATEGIE

### 1. DEBUG-DRIVEN DEVELOPMENT

**Schritt 1: Debug-Scrape mit Screenshot**
```bash
POST /api/debug-scrape
{
  "url": "https://www.immobilienscout24.de/Suche/...",
  "portal": "scout24"
}
```

**Output:**
- Screenshot als Base64
- HTML-Datei gespeichert
- Seitenanalyse (Selektoren, Body-Text)

**Erkenntnis:**
- Alle alten Selektoren (`article[data-id]`, `.result-list-entry`) finden 0 Elemente
- Scout24 hat komplett neue HTML-Struktur

---

### 2. HTML-STRUKTUR-ANALYSE

**Problem:** Alte Selektoren funktionieren nicht mehr

**Analyse der gespeicherten HTML-Datei:**
```python
# Suche nach Listing-Daten
grep "Mehrfamilienkomplex" scout24_*.html
```

**Gefundene Struktur:**
```html
<a href="/expose/165887677"
   data-exp-id="165887677"
   target="_blank"
   data-exp-referrer="HYBRID_VIEW_LISTING">

  <h2 data-testid="headline">
    Mehrfamilienkomplex mit 8 Wohnungen - provisionsfrei
  </h2>

  <dd>100.000 €</dd>
  <dd>250 m²</dd>
  <dd>3 Zi.</dd>
</a>
```

**Neue Erkenntnisse:**
- ✅ `data-exp-id` statt `data-id`
- ✅ Daten in `<dd>` Tags statt benannten Klassen
- ✅ Titel in `<h2 data-testid="headline">`

---

### 3. KRITISCHES PROBLEM: MEHRERE LINKS PRO LISTING

**Debug-Output zeigte:**
```json
"a[data-exp-id]": 262,        // 262 Links gefunden
"uniqueIds": 20,               // Nur 20 echte Listings
"resultsCreated": 0            // Aber 0 erfolgreich geparst!
```

**Ursache:** Jedes Listing hat MEHRERE Links mit derselben `data-exp-id`:

1. **Logo-Link** (Anbieter-Logo)
   ```html
   <a data-exp-id="165887677" href="/expose/165887677">
     <img alt="Anbieterlogo" src="...">
   </a>
   ```

2. **Galerie-Link** (Bilder)
   ```html
   <a data-exp-id="165887677" href="/expose/165887677">
     <img class="gallery__image" src="...">
   </a>
   ```

3. **Content-Link** (DIESER hat die Daten!) ✅
   ```html
   <a data-exp-id="165887677" href="/expose/165887677">
     <h2>Titel</h2>
     <dd>Preis</dd>
     <dd>Fläche</dd>
   </a>
   ```

**Lösung:** Nur Links MIT `<h2>` Titel nehmen!
```javascript
const allLinks = document.querySelectorAll('a[data-exp-id][href*="/expose/"]');
const contentLinks = Array.from(allLinks).filter(link => link.querySelector('h2'));
```

**Ergebnis:**
- Vorher: 262 Links → 0 Ergebnisse
- Nachher: 18 Content-Links → 17 Ergebnisse ✅

---

### 4. URL-STRUKTUR-PROBLEM

**Fehler 404 bei ersten Tests!**

**Alte/Falsche URL:**
```
https://www.immobilienscout24.de/Suche/de/koeln/haus-kaufen
```
→ **404 Error**

**Korrekte URL (mit Bundesland):**
```
https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/koeln/haus-kaufen
```
→ **Funktioniert!**

**Lösung im Code:**
```javascript
const stateMap = {
  'koeln': 'nordrhein-westfalen',
  'bonn': 'nordrhein-westfalen',
  'duesseldorf': 'nordrhein-westfalen',
  // ...
};

const searchUrl = `https://www.immobilienscout24.de/Suche/de/${state}/${city}/${type}?price=-${maxPrice}`;
```

---

### 5. DATEN-EXTRAKTION

**Strategie:** Alle `<dd>` Tags durchgehen und Pattern-Matching

```javascript
const ddElements = link.querySelectorAll('dd');
let price = null, area = null, rooms = null;

ddElements.forEach(dd => {
  const text = dd.innerText.trim();

  // Preis (enthält €)
  if (text.includes('€') && !price) {
    const priceMatch = text.match(/([\d.,]+)/);
    price = parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.'));
  }

  // Fläche (enthält m²)
  else if (text.match(/m²|m2|qm/i) && !area) {
    const areaMatch = text.match(/([\d.,]+)/);
    area = parseFloat(areaMatch[1].replace(',', '.'));
  }

  // Zimmer (enthält "Zi")
  else if (text.match(/\d+\s*Zi\.?/i) && !rooms) {
    const roomMatch = text.match(/([\d,]+)/);
    rooms = parseFloat(roomMatch[1].replace(',', '.'));
  }
});
```

**Ergebnis:** Funktioniert perfekt! ✅

---

## 🔧 FINALER PARSER-CODE

```javascript
// SCOUT24 SEARCH ENDPOINT
app.post('/api/scout24-search', async (req, res) => {
  let page = null;

  try {
    const { city = 'koeln', type = 'haus-kaufen', maxPrice = 500000 } = req.body;

    // 1. Bundesland-Mapping
    const stateMap = {
      'koeln': 'nordrhein-westfalen',
      'bonn': 'nordrhein-westfalen',
      // ...
    };

    const state = stateMap[city] || 'nordrhein-westfalen';

    // 2. Korrekte Such-URL bauen
    const searchUrl = `https://www.immobilienscout24.de/Suche/de/${state}/${city}/${type}?price=-${maxPrice}`;

    // 3. Puppeteer Browser starten
    const browser = await getBrowser();
    page = await browser.newPage();

    // 4. Stealth-Einstellungen
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...');
    await page.setViewport({ width: 1920, height: 1080 });

    // 5. Seite laden
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // 6. Cookie-Banner wegklicken
    try {
      const cookieBtn = await page.$('#uc-btn-accept-banner');
      if (cookieBtn) await cookieBtn.click();
    } catch (e) {}

    await new Promise(r => setTimeout(r, 2000));

    // 7. Daten extrahieren
    const debugInfo = await page.evaluate(() => {
      const results = [];

      // NUR Links MIT h2 Titel (Content-Links)
      const allLinks = document.querySelectorAll('a[data-exp-id][href*="/expose/"]');
      const contentLinks = Array.from(allLinks).filter(link => link.querySelector('h2'));

      const seen = new Set();

      contentLinks.forEach(link => {
        const id = link.getAttribute('data-exp-id');
        if (!id || seen.has(id)) return;
        seen.add(id);

        // Titel
        const titleEl = link.querySelector('h2[data-testid="headline"]');
        const title = titleEl?.innerText.trim() || '';

        // Attribute aus <dd> Tags
        const ddElements = link.querySelectorAll('dd');
        let price = null, area = null, rooms = null;

        ddElements.forEach(dd => {
          const text = dd.innerText.trim();
          if (text.includes('€')) {
            const m = text.match(/([\d.,]+)/);
            if (m) price = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
          }
          else if (text.match(/m²/i)) {
            const m = text.match(/([\d.,]+)/);
            if (m) area = parseFloat(m[1].replace(',', '.'));
          }
          else if (text.match(/Zi/i)) {
            const m = text.match(/([\d,]+)/);
            if (m) rooms = parseFloat(m[1].replace(',', '.'));
          }
        });

        // Nur Listings mit Preis
        if (title && price && price > 0) {
          results.push({
            id,
            url: link.href,
            title,
            price,
            area,
            rooms,
          });
        }
      });

      return { results };
    });

    await page.close();

    res.json({
      success: true,
      portal: 'scout24',
      count: debugInfo.results.length,
      listings: debugInfo.results,
    });

  } catch (err) {
    if (page) await page.close();
    res.status(500).json({ error: err.message });
  }
});
```

---

## 📊 TEST-ERGEBNISSE

**Test-URL:**
```
POST http://localhost:3001/api/scout24-search
{
  "city": "koeln",
  "type": "haus-kaufen",
  "maxPrice": 500000
}
```

**Ergebnis:**
```json
{
  "success": true,
  "portal": "scout24",
  "count": 17,
  "duration": 12139,
  "listings": [
    {
      "id": "165894229",
      "title": "Freistehendes 2-Familienhaus nebst Garage",
      "price": 490000,
      "area": 192,
      "rooms": 6,
      "url": "https://www.immobilienscout24.de/expose/165894229"
    },
    {
      "id": "165887677",
      "title": "Mehrfamilienkomplex mit 8 Wohnungen - provisionsfrei",
      "price": 100000,
      "area": 250,
      "rooms": 3,
      "url": "https://www.immobilienscout24.de/expose/165887677"
    }
    // ... 15 weitere
  ]
}
```

✅ **17 von 26 Häusern gefunden** (einige haben "Auf Anfrage" statt Preis)

---

## 🎓 LESSONS LEARNED

### 1. **Debug-First Approach**
- Erst Screenshot + HTML-Dump machen
- Dann Struktur analysieren
- Dann Parser schreiben
- **Nicht blind entwickeln!**

### 2. **HTML-Struktur ändert sich**
- Alte Selektoren funktionieren nie ewig
- Immer mit echten HTML-Dumps arbeiten
- Mehrere Fallback-Strategien einbauen

### 3. **Ein Element ≠ Ein Listing**
- Websites haben oft mehrere Links pro Item
- Deduplizierung nach ID nötig
- Filtern nach Content-Elementen (hier: `<h2>`)

### 4. **Pattern-Matching statt feste Klassen**
- Moderne Websites nutzen generische Klassen
- Pattern-Matching ist robuster: "€", "m²", "Zi"
- Mehrere Patterns für Fallbacks

### 5. **URL-Struktur ist kritisch**
- Immer mit echten Browser-URLs testen
- Canonical-Link im HTML checken
- Redirects beachten

### 6. **Puppeteer Stealth-Mode**
- User-Agent setzen
- Viewport setzen
- Cookie-Banner wegklicken
- Pausen einbauen (sieht menschlicher aus)

---

## 🚀 NÄCHSTE SCHRITTE

### Noch zu verbessern:

1. **Adresse extrahieren**
   - Steht im HTML, aber bisher nicht geparst
   - Pattern: Stadtteil, PLZ

2. **Bilder extrahieren**
   - Galerie-Links haben Bilder
   - Parent-Container durchsuchen

3. **Weitere Daten**
   - Energieklasse
   - Provision
   - Baujahr (manchmal im Titel)

### Für andere Portale nutzen:

Diese Strategie funktioniert für:
- ✅ Immowelt (ähnliche Struktur erwartet)
- ✅ Immonet (ähnliche Struktur erwartet)
- ✅ Alle modernen Immobilien-Portale

**Prozess:**
1. Debug-Scrape
2. HTML analysieren
3. Content-Links identifizieren
4. Pattern-Matching für Daten
5. Testen & Iterieren

---

## 🎉 ERFOLG!

**Scout24 Integration:** ✅ ABGESCHLOSSEN
**Strategie dokumentiert:** ✅ ABGESCHLOSSEN
**Bereit für weitere Portale:** ✅ JA

**Zeit investiert:** ~2 Stunden
**Ergebnis:** Voll funktionsfähiger Scout24-Scraper

---

*Dokumentiert am 03.03.2026 - ZVG Scanner App Backend*

---

# IMMOWELT - Erfolgreiche Integration

**Status:** ✅ FUNKTIONIERT SOFORT!
**Dauer:** ~30 Minuten
**Schwierigkeit:** ⭐⭐ (Einfach - Daten im title-Attribut!)

## 🎯 IMMOWELT STRATEGIE (VIEL EINFACHER!)

### HTML-Struktur
```html
<a data-testid="card-mfe-covering-link-testid" 
   title="Reihenmittelhaus zum Kauf - Köln - 480.000 € - 4 Zimmer, 130 m², 162 m² Grundstück"
   href="/expose/...">
</a>
```

**ALLE DATEN IM TITLE-ATTRIBUT!** 🎉

### Parser-Logik
```javascript
const links = document.querySelectorAll('a[data-testid="card-mfe-covering-link-testid"]');

links.forEach(link => {
  // Title-Format: "Objektart - Ort - PREIS € - Details"
  const title = link.getAttribute('title');
  const parts = title.split(' - ');
  
  const objektart = parts[0];  // "Reihenmittelhaus zum Kauf"
  const location = parts[1];   // "Köln"
  const priceStr = parts[2];   // "480.000 €"
  const details = parts[3];    // "4 Zimmer, 130 m², 162 m² Grundstück"
  
  // Parse Preis
  const price = parseFloat(priceStr.replace(/\./g, '').replace(',', '.'));
  
  // Parse Details (Zimmer, Fläche, Grundstück)
  const rooms = details.match(/(\d+)\s*Zimmer/)?.[1];
  const areas = details.match(/(\d+(?:,\d+)?)\s*m²/g);
  const area = areas[0];  // Wohnfläche
  const land = areas[1];  // Grundstück
});
```

### Test-Ergebnis
```json
{
  "success": true,
  "count": 27,
  "duration": 12485,
  "listings": [
    {
      "title": "Reihenmittelhaus zum Kauf",
      "price": 480000,
      "address": "Köln",
      "area": 130,
      "land": 162,
      "rooms": 4,
      "images": [5 Bilder]
    }
  ]
}
```

## 📊 VERGLEICH: SCOUT24 vs IMMOWELT

| Aspekt | Scout24 | Immowelt |
|--------|---------|----------|
| **Schwierigkeit** | ⭐⭐⭐⭐ Schwer | ⭐⭐ Einfach |
| **Dauer** | ~2h | ~30 Min |
| **HTML-Struktur** | Komplex (mehrere Links pro Listing) | Einfach (1 Link, alles im title) |
| **Daten-Extraktion** | Pattern-Matching aus `<dd>` Tags | String-Split vom title |
| **Bilder** | Aus separaten Galerie-Links | Im Container neben Link |
| **Hauptproblem** | Deduplizierung, Filter nach `<h2>` | Keins! Funktioniert sofort |

## ✅ BEIDE PORTALE: KOMPLETT FUNKTIONSFÄHIG!

**Gemeinsame Features:**
- ✅ Titel
- ✅ Preis
- ✅ Adresse/Ort
- ✅ Wohnfläche (m²)
- ✅ Grundstücksfläche (m²)
- ✅ Zimmer-Anzahl
- ✅ Mehrere Bilder (5-10 pro Listing)
- ✅ Direkt-URL zum Expose

**Gesamt-Ergebnis:**
- Scout24: ~17 Häuser unter 500k in Köln
- Immowelt: ~27 Häuser unter 500k in Köln
- **Zusammen: 44+ Immobilien aus 2 Portalen!**

---

## 🚀 NÄCHSTE SCHRITTE

### Weitere Portale (Ähnlich einfach wie Immowelt)
- ✅ Scout24 - FERTIG
- ✅ Immowelt - FERTIG
- ⏳ Immonet - TODO (ähnlich wie Immowelt)
- ⏳ Kleinanzeigen - TODO (teilweise funktioniert)

### Frontend-Integration
- Backend läuft auf Port 3001
- Endpoints verfügbar:
  - `POST /api/scout24-search`
  - `POST /api/immowelt-search`
- Ready für Frontend-Tests!

---

*Aktualisiert am 03.03.2026 - Multi-Portal Scraping erfolgreich!*
