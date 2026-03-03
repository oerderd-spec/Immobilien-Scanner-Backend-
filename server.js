// ZVG Backend Server
// - PDF-Parsing für Gutachten
// - Browser-basiertes Scraping mit Puppeteer
// - Portal-Aggregation

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');

// Puppeteer lazy-load (nur wenn benötigt)
let puppeteer = null;
let browser = null;

async function getBrowser() {
  if (!puppeteer) {
    puppeteer = require('puppeteer');
  }
  if (!browser) {
    console.log('Starte Puppeteer Browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════════════════════════════
// PDF-PARSING ENDPOINT
// ═══════════════════════════════════════════════════════════════

app.post('/api/parse-pdf', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    console.log('Parsing PDF:', url);

    // PDF herunterladen
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    // PDF parsen
    const pdfData = await pdfParse(response.data);
    const text = pdfData.text;

    // Daten extrahieren
    const extracted = extractDataFromPdf(text);

    console.log('Extracted:', extracted);

    res.json({
      success: true,
      pages: pdfData.numpages,
      extracted,
      rawText: text.substring(0, 2000), // Erste 2000 Zeichen für Debug
    });
  } catch (err) {
    console.error('PDF Parse Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Extrahiert strukturierte Daten aus PDF-Text
function extractDataFromPdf(text) {
  const data = {
    wohnflaeche: null,
    grundstueck: null,
    baujahr: null,
    zimmer: null,
    heizung: null,
    fenster: null,
    dach: null,
    keller: null,
    zustand: null,
    energieausweis: null,
    ausstattung: [],
  };

  // Bereinigter Text
  const t = text.replace(/\s+/g, ' ').toLowerCase();

  // Wohnfläche
  const wohnMatch = text.match(/wohnfl[äa]che[:\s]*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:m²|m2|qm)?/i);
  if (wohnMatch) data.wohnflaeche = parseFloat(wohnMatch[1].replace(',', '.'));

  // Nutzfläche
  if (!data.wohnflaeche) {
    const nutzMatch = text.match(/nutzfl[äa]che[:\s]*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:m²|m2|qm)?/i);
    if (nutzMatch) data.wohnflaeche = parseFloat(nutzMatch[1].replace(',', '.'));
  }

  // Grundstück
  const grundMatch = text.match(/grundst[üu]cks?(?:fl[äa]che|gr[öo][ßs]e)?[:\s]*(?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:m²|m2|qm)?/i);
  if (grundMatch) data.grundstueck = parseFloat(grundMatch[1].replace(',', '.'));

  // Baujahr
  const baujahrMatch = text.match(/baujahr[:\s]*(?:ca\.?\s*)?(\d{4})/i);
  if (baujahrMatch) data.baujahr = parseInt(baujahrMatch[1]);

  // Zimmer
  const zimmerMatch = text.match(/(\d+(?:[.,]\d)?)\s*zimmern?/i);
  if (zimmerMatch) data.zimmer = parseFloat(zimmerMatch[1].replace(',', '.'));

  // Heizung
  if (t.includes('gasheizung') || t.includes('gas-heizung')) data.heizung = 'Gas';
  else if (t.includes('ölheizung') || t.includes('öl-heizung')) data.heizung = 'Öl';
  else if (t.includes('wärmepumpe')) data.heizung = 'Wärmepumpe';
  else if (t.includes('fernwärme')) data.heizung = 'Fernwärme';
  else if (t.includes('pellet')) data.heizung = 'Pellet';
  else if (t.includes('nachtspeicher')) data.heizung = 'Nachtspeicher';
  else if (t.includes('elektroheizung')) data.heizung = 'Elektro';

  // Fenster
  if (t.includes('kunststofffenster')) data.fenster = 'Kunststoff';
  else if (t.includes('holzfenster')) data.fenster = 'Holz';
  else if (t.includes('alufenster') || t.includes('aluminiumfenster')) data.fenster = 'Aluminium';

  if (t.includes('dreifachverglasung') || t.includes('3-fach')) data.fenster = (data.fenster || '') + ' 3-fach';
  else if (t.includes('doppelverglasung') || t.includes('2-fach')) data.fenster = (data.fenster || '') + ' 2-fach';
  else if (t.includes('einfachverglasung') || t.includes('1-fach')) data.fenster = (data.fenster || '') + ' 1-fach';

  // Dach
  if (t.includes('neu eingedeckt') || t.includes('dachsanierung')) data.dach = 'saniert';
  else if (t.includes('dach undicht') || t.includes('dachschäden')) data.dach = 'sanierungsbedürftig';

  // Keller
  if (t.includes('unterkellert') || t.includes('vollkeller')) data.keller = true;
  else if (t.includes('teilunterkellert')) data.keller = 'teil';
  else if (t.includes('nicht unterkellert') || t.includes('ohne keller')) data.keller = false;

  // Zustand
  if (t.includes('sanierungsbedürftig') || t.includes('renovierungsbedürftig')) data.zustand = 'sanierungsbedürftig';
  else if (t.includes('modernisiert') || t.includes('kernsaniert')) data.zustand = 'modernisiert';
  else if (t.includes('guter zustand') || t.includes('gepflegt')) data.zustand = 'gut';
  else if (t.includes('mangelhafter zustand') || t.includes('schlecht')) data.zustand = 'schlecht';

  // Energieausweis
  const energieMatch = text.match(/energieverbrauch[:\s]*(\d+(?:[.,]\d+)?)\s*kwh/i);
  if (energieMatch) data.energieausweis = parseFloat(energieMatch[1].replace(',', '.'));

  // Ausstattung
  if (t.includes('balkon')) data.ausstattung.push('Balkon');
  if (t.includes('terrasse')) data.ausstattung.push('Terrasse');
  if (t.includes('garten')) data.ausstattung.push('Garten');
  if (t.includes('garage')) data.ausstattung.push('Garage');
  if (t.includes('carport')) data.ausstattung.push('Carport');
  if (t.includes('stellplatz')) data.ausstattung.push('Stellplatz');
  if (t.includes('einbauküche')) data.ausstattung.push('EBK');
  if (t.includes('fußbodenheizung')) data.ausstattung.push('FBH');
  if (t.includes('kamin') || t.includes('kachelofen')) data.ausstattung.push('Kamin');
  if (t.includes('sauna')) data.ausstattung.push('Sauna');
  if (t.includes('pool') || t.includes('schwimmbad')) data.ausstattung.push('Pool');
  if (t.includes('aufzug') || t.includes('fahrstuhl')) data.ausstattung.push('Aufzug');
  if (t.includes('solar') || t.includes('photovoltaik')) data.ausstattung.push('Solar');
  if (t.includes('rolladen') || t.includes('rollladen')) data.ausstattung.push('Rollläden');

  return data;
}

// ═══════════════════════════════════════════════════════════════
// ZVG-PORTAL SCRAPING MIT PUPPETEER (umgeht Session-Sperre)
// ═══════════════════════════════════════════════════════════════

app.post('/api/zvg-details', async (req, res) => {
  const startTime = Date.now();
  let page = null;

  try {
    const { url } = req.body;
    if (!url || !url.includes('zvg-portal')) {
      return res.status(400).json({ error: 'ZVG-Portal URL required' });
    }

    console.log('🔍 Scraping ZVG Details:', url);

    const browser = await getBrowser();
    page = await browser.newPage();

    // Realistic browser settings
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate to page
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for content
    await page.waitForSelector('body', { timeout: 10000 });

    // Extract all data from page
    const data = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const html = document.body.innerHTML || '';

      // Helper function
      const extract = (patterns, source = text) => {
        for (const p of patterns) {
          const m = source.match(p);
          if (m) return m[1]?.trim() || m[0];
        }
        return null;
      };

      // Verkehrswert
      const verkehrswertMatch = text.match(/Verkehrswert[:\s]*([\d.,]+)\s*(?:€|EUR)/i);
      const verkehrswert = verkehrswertMatch ? parseFloat(verkehrswertMatch[1].replace(/\./g, '').replace(',', '.')) : null;

      // Wohnfläche
      const wohnflaecheMatch = text.match(/Wohnfl[äa]che[:\s]*(?:ca\.?\s*)?([\d.,]+)\s*(?:m²|m2|qm)/i);
      const wohnflaeche = wohnflaecheMatch ? parseFloat(wohnflaecheMatch[1].replace(',', '.')) : null;

      // Grundstück
      const grundstueckMatch = text.match(/Grundst[üu]ck[^\d]*([\d.,]+)\s*(?:m²|m2|qm)/i);
      const grundstueck = grundstueckMatch ? parseFloat(grundstueckMatch[1].replace(',', '.')) : null;

      // Baujahr
      const baujahrMatch = text.match(/Baujahr[:\s]*(\d{4})/i);
      const baujahr = baujahrMatch ? parseInt(baujahrMatch[1]) : null;

      // Zimmer
      const zimmerMatch = text.match(/(\d+(?:[.,]\d)?)\s*Zimmer/i);
      const zimmer = zimmerMatch ? parseFloat(zimmerMatch[1].replace(',', '.')) : null;

      // Aktenzeichen
      const azMatch = text.match(/(?:Aktenzeichen|Az\.?)[:\s]*([^\s,]+)/i);
      const aktenzeichen = azMatch ? azMatch[1] : null;

      // Termin
      const terminMatch = text.match(/(\d{2}\.\d{2}\.\d{4})/);
      const termin = terminMatch ? terminMatch[1] : null;

      // Adresse
      const adresseMatch = text.match(/(?:Objekt|Lage)[:\s]*([^\n]+)/i);
      const adresse = adresseMatch ? adresseMatch[1].trim() : null;

      // Grundbuch
      const grundbuchMatch = text.match(/Grundbuch[:\s]*([^\n]+)/i) ||
                            text.match(/Gemarkung[:\s]*([^\n]+)/i);
      const grundbuch = grundbuchMatch ? grundbuchMatch[1].trim() : null;

      // PDF Links (Gutachten, Exposé, etc.)
      const pdfLinks = [];
      const linkElements = document.querySelectorAll('a[href*=".pdf"], a[href*="gutachten"], a[href*="expose"]');
      linkElements.forEach(a => {
        const href = a.href;
        const text = a.innerText?.trim() || '';
        if (href && !pdfLinks.find(l => l.url === href)) {
          pdfLinks.push({ url: href, text: text || 'PDF' });
        }
      });

      // Bilder
      const bilder = [];
      const imgElements = document.querySelectorAll('img[src*="bild"], img[src*="foto"], img[src*="image"], img[src*="jpg"], img[src*="jpeg"]');
      imgElements.forEach(img => {
        if (img.src && img.src.includes('http') && !bilder.includes(img.src)) {
          bilder.push(img.src);
        }
      });

      // Beschreibung
      const beschreibungMatch = text.match(/Beschreibung[:\s]+(.{50,500}?)(?=Verkehrswert|Termin|Gutachten|$)/is);
      const beschreibung = beschreibungMatch ? beschreibungMatch[1].trim() : null;

      return {
        verkehrswert,
        wohnflaeche,
        grundstueck,
        baujahr,
        zimmer,
        aktenzeichen,
        termin,
        adresse,
        grundbuch,
        beschreibung,
        pdfLinks,
        bilder: bilder.slice(0, 10),
        rawTextLength: text.length,
      };
    });

    await page.close();

    const duration = Date.now() - startTime;
    console.log(`✅ ZVG Details gescraped in ${duration}ms:`, JSON.stringify(data, null, 2));

    res.json({
      success: true,
      duration,
      data,
    });

  } catch (err) {
    console.error('❌ ZVG Scraping Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// Batch-Scraping für mehrere URLs
app.post('/api/zvg-batch', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'URLs array required' });
    }

    console.log(`📦 Batch-Scraping ${urls.length} ZVG URLs...`);

    const results = [];
    for (const url of urls.slice(0, 20)) { // Max 20 pro Batch
      try {
        // Internal call to zvg-details
        const response = await axios.post(`http://localhost:${PORT}/api/zvg-details`, { url });
        results.push({ url, success: true, data: response.data.data });
      } catch (err) {
        results.push({ url, success: false, error: err.message });
      }
      // Pause zwischen Requests
      await new Promise(r => setTimeout(r, 1000));
    }

    res.json({
      success: true,
      total: urls.length,
      processed: results.length,
      results,
    });

  } catch (err) {
    console.error('Batch Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Gutachten-PDF direkt herunterladen und parsen
app.post('/api/zvg-gutachten', async (req, res) => {
  let page = null;

  try {
    const { zvgUrl } = req.body;
    if (!zvgUrl) {
      return res.status(400).json({ error: 'ZVG URL required' });
    }

    console.log('📄 Suche Gutachten-PDF für:', zvgUrl);

    // Erst Details scrapen um PDF-Links zu finden
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(zvgUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // PDF-Links finden
    const pdfLinks = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        const text = (a.innerText || '').toLowerCase();
        if (href.includes('.pdf') || text.includes('gutachten') || text.includes('exposé')) {
          links.push({ url: href, text: a.innerText?.trim() });
        }
      });
      return links;
    });

    await page.close();

    if (pdfLinks.length === 0) {
      return res.json({ success: false, message: 'Keine PDF-Links gefunden' });
    }

    console.log(`📎 ${pdfLinks.length} PDF-Links gefunden:`, pdfLinks);

    // Erstes Gutachten-PDF parsen
    const gutachtenLink = pdfLinks.find(l =>
      l.text?.toLowerCase().includes('gutachten') ||
      l.url?.toLowerCase().includes('gutachten')
    ) || pdfLinks[0];

    if (!gutachtenLink?.url) {
      return res.json({ success: false, message: 'Kein Gutachten-Link gefunden', pdfLinks });
    }

    // PDF herunterladen und parsen
    console.log('⬇️ Lade PDF:', gutachtenLink.url);
    const pdfResponse = await axios.get(gutachtenLink.url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const pdfData = await pdfParse(pdfResponse.data);
    const extracted = extractDataFromPdf(pdfData.text);

    res.json({
      success: true,
      pdfUrl: gutachtenLink.url,
      pages: pdfData.numpages,
      extracted,
      allPdfLinks: pdfLinks,
    });

  } catch (err) {
    console.error('❌ Gutachten Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// MULTI-GUTACHTEN PARSEN (alle PDFs einer Immobilie)
// ═══════════════════════════════════════════════════════════════
app.post('/api/zvg-all-pdfs', async (req, res) => {
  let page = null;

  try {
    const { zvgUrl } = req.body;
    if (!zvgUrl) {
      return res.status(400).json({ error: 'ZVG URL required' });
    }

    console.log('📄 Lade ALLE PDFs für:', zvgUrl);

    // Seite scrapen
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(zvgUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Alle Links und Bilder extrahieren
    const pageData = await page.evaluate(() => {
      const links = [];
      const images = [];

      // Alle PDF/Dokument-Links sammeln
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        const text = (a.innerText || '').trim();
        const lowerText = text.toLowerCase();
        const lowerHref = href.toLowerCase();

        // PDFs
        if (lowerHref.includes('.pdf')) {
          let type = 'pdf';
          if (lowerText.includes('gutachten') || lowerHref.includes('gutachten')) {
            type = 'gutachten';
          } else if (lowerText.includes('exposé') || lowerText.includes('expose')) {
            type = 'expose';
          } else if (lowerText.includes('bekanntmachung')) {
            type = 'bekanntmachung';
          } else if (lowerText.includes('foto') || lowerText.includes('bild')) {
            type = 'fotos';
          }
          links.push({ url: href, text: text || 'PDF', type });
        }
        // Andere Dokumente
        else if (lowerText.includes('gutachten') || lowerText.includes('exposé')) {
          links.push({ url: href, text, type: 'dokument' });
        }
      });

      // Bilder sammeln
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || '';
        if (src.includes('http') && !src.includes('logo') && !src.includes('icon')) {
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          // Nur größere Bilder (keine Icons)
          if (width > 100 || height > 100 || !width) {
            images.push({
              url: src,
              alt: img.alt || '',
              width,
              height,
            });
          }
        }
      });

      return { links, images };
    });

    await page.close();

    // Kategorisiere und dedupliziere Links
    const gutachtenLinks = pageData.links.filter(l => l.type === 'gutachten');
    const exposeLinks = pageData.links.filter(l => l.type === 'expose');
    const bekanntmachungLinks = pageData.links.filter(l => l.type === 'bekanntmachung');
    const fotoLinks = pageData.links.filter(l => l.type === 'fotos');
    const otherPdfs = pageData.links.filter(l => l.type === 'pdf');

    console.log(`📎 Gefunden: ${gutachtenLinks.length} Gutachten, ${exposeLinks.length} Exposés, ${pageData.images.length} Bilder`);

    // Parse alle Gutachten-PDFs (max 3)
    const parsedGutachten = [];
    for (const link of gutachtenLinks.slice(0, 3)) {
      try {
        console.log(`⬇️ Parse Gutachten: ${link.text}`);
        const pdfResponse = await axios.get(link.url, {
          responseType: 'arraybuffer',
          timeout: 60000,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const pdfData = await pdfParse(pdfResponse.data);
        const extracted = extractDataFromPdf(pdfData.text);
        parsedGutachten.push({
          url: link.url,
          text: link.text,
          pages: pdfData.numpages,
          extracted,
        });
      } catch (err) {
        console.log(`⚠️ PDF-Fehler bei ${link.text}:`, err.message);
        parsedGutachten.push({
          url: link.url,
          text: link.text,
          error: err.message,
        });
      }
    }

    // Kombiniere Daten aus allen Gutachten (spätere überschreiben frühere wenn vorhanden)
    let combinedData = {};
    let allAusstattung = [];
    for (const g of parsedGutachten) {
      if (g.extracted) {
        // Merge: Nur nicht-null Werte übernehmen
        Object.entries(g.extracted).forEach(([key, val]) => {
          if (val !== null && val !== undefined) {
            if (key === 'ausstattung' && Array.isArray(val)) {
              allAusstattung = [...allAusstattung, ...val];
            } else if (!combinedData[key] || combinedData[key] === null) {
              combinedData[key] = val;
            }
          }
        });
      }
    }
    combinedData.ausstattung = [...new Set(allAusstattung)]; // Deduplizieren

    res.json({
      success: true,
      gutachten: gutachtenLinks,
      expose: exposeLinks,
      bekanntmachung: bekanntmachungLinks,
      fotos: fotoLinks,
      otherPdfs,
      images: pageData.images,
      parsedGutachten,
      combinedData,
    });

  } catch (err) {
    console.error('❌ All-PDFs Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DEBUG ENDPOINT - Seite analysieren
// ═══════════════════════════════════════════════════════════════

app.post('/api/debug-page', async (req, res) => {
  let page = null;

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log('🔍 Debug-Analyse:', url);

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Cookie-Banner wegklicken
    try {
      const cookieBtn = await page.$('#uc-btn-accept-banner, [data-testid="uc-accept-all-button"], .fc-cta-consent, #onetrust-accept-btn-handler');
      if (cookieBtn) {
        await cookieBtn.click();
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 3000));

    // Screenshot machen
    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

    // Seiten-Analyse
    const analysis = await page.evaluate(() => {
      const body = document.body;

      // Alle möglichen Listing-Container finden
      const possibleContainers = [
        '[data-item="result"]',
        '.result-list-entry',
        'article[data-id]',
        '[data-test="listitem"]',
        '.listitem',
        'article',
        '[class*="result"]',
        '[class*="listing"]',
        '[class*="estate"]',
        '[class*="property"]',
        'li[class*="result"]',
      ];

      const found = {};
      possibleContainers.forEach(sel => {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          found[sel] = els.length;
        }
      });

      // Erste paar article/div Elements
      const articles = Array.from(document.querySelectorAll('article, [role="listitem"], li')).slice(0, 5);
      const articleInfo = articles.map(a => ({
        tag: a.tagName,
        classes: a.className.substring(0, 100),
        dataAttrs: Array.from(a.attributes).filter(attr => attr.name.startsWith('data-')).map(a => `${a.name}=${a.value}`).slice(0, 5),
      }));

      return {
        title: document.title,
        url: window.location.href,
        bodyText: body.innerText.substring(0, 2000),
        foundSelectors: found,
        sampleArticles: articleInfo,
        hasResults: body.innerText.includes('Ergebnis') || body.innerText.includes('Treffer') || body.innerText.includes('Immobilie'),
      };
    });

    await page.close();

    res.json({
      success: true,
      analysis,
      screenshot: `data:image/png;base64,${screenshot}`,
    });

  } catch (err) {
    console.error('Debug Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// IMMOBILIENSCOUT24 SCRAPING MIT PUPPETEER
// ═══════════════════════════════════════════════════════════════

app.post('/api/scout24-search', async (req, res) => {
  let page = null;
  const startTime = Date.now();

  try {
    const { city = 'koeln', type = 'haus-kaufen', maxPrice = 500000, radius = 50 } = req.body;

    console.log(`🏠 Scout24 Suche: ${city} - ${type} - max ${maxPrice}€`);

    const browser = await getBrowser();
    page = await browser.newPage();

    // Stealth-Modus: Realistische Browser-Einstellungen
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    // Cookies akzeptieren falls nötig
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Such-URL bauen - Scout24 benötigt Bundesland + Stadt
    // Mapping: Stadt -> Bundesland
    const stateMap = {
      'koeln': 'nordrhein-westfalen',
      'bonn': 'nordrhein-westfalen',
      'duesseldorf': 'nordrhein-westfalen',
      'leverkusen': 'nordrhein-westfalen',
      'bergisch-gladbach': 'nordrhein-westfalen',
      'troisdorf': 'nordrhein-westfalen',
      'siegburg': 'nordrhein-westfalen',
      'pulheim': 'nordrhein-westfalen',
      'huerth': 'nordrhein-westfalen',
      'bruehl': 'nordrhein-westfalen',
    };

    const state = stateMap[city] || 'nordrhein-westfalen';
    const searchUrl = `https://www.immobilienscout24.de/Suche/de/${state}/${city}/${type}?price=-${maxPrice}&pricetype=calculatedtotalprice`;
    console.log('📍 URL:', searchUrl);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Cookie-Banner wegklicken falls vorhanden
    try {
      const cookieBtn = await page.$('#uc-btn-accept-banner, [data-testid="uc-accept-all-button"]');
      if (cookieBtn) {
        await cookieBtn.click();
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {}

    // Warten auf Ergebnisse
    await new Promise(r => setTimeout(r, 2000));

    // Daten extrahieren - NEUE SCOUT24 STRUKTUR (2026)
    const debugInfo = await page.evaluate(() => {
      // DEBUG: Verschiedene Selektoren testen
      const test1 = document.querySelectorAll('a[data-exp-id]');
      const test2 = document.querySelectorAll('a[href*="/expose/"]');
      const test3 = document.querySelectorAll('a[data-exp-id][href*="/expose/"]');

      const debug = {
        'a[data-exp-id]': test1.length,
        'a[href*="/expose/"]': test2.length,
        'a[data-exp-id][href*="/expose/"]': test3.length,
        bodyText: document.body.innerText.substring(0, 500),
      };

      // Scout24: Jedes Listing hat mehrere <a data-exp-id> Links
      // - Galerie-Links (mit <img class="gallery__image">)
      // - Content-Links (mit <h2> Titel und Daten)
      const allLinks = document.querySelectorAll('a[data-exp-id][href*="/expose/"]');

      // Gruppiere Links nach data-exp-id
      const linksById = {};
      allLinks.forEach(link => {
        const id = link.getAttribute('data-exp-id');
        if (!id) return;
        if (!linksById[id]) linksById[id] = [];
        linksById[id].push(link);
      });

      debug.allLinksFound = allLinks.length;
      debug.uniqueListings = Object.keys(linksById).length;

      const results = [];
      const parseErrors = [];

      Object.entries(linksById).forEach(([id, links], index) => {
        try {
          // Finde Content-Link (mit h2)
          const contentLink = links.find(link => link.querySelector('h2'));
          if (!contentLink) {
            if (index < 3) parseErrors.push(`Listing ${id}: Kein Content-Link mit h2`);
            return;
          }

          const url = contentLink.href;

          // Titel - h2 mit data-testid="headline"
          const titleEl = contentLink.querySelector('h2[data-testid="headline"]') ||
                         contentLink.querySelector('h2');
          const title = titleEl ? titleEl.innerText.trim() : '';

          if (!title) {
            if (index < 3) parseErrors.push(`Listing ${id}: Kein Titel im Content-Link`);
            return;
          }

          // Attribute - alle <dd> Elemente im Content-Link
          const ddElements = contentLink.querySelectorAll('dd');
          let price = null, area = null, rooms = null;

          ddElements.forEach(dd => {
            const text = dd.innerText.trim();

            // Preis (enthält €)
            if (text.includes('€') && !price) {
              const priceMatch = text.match(/([\d.,]+)/);
              if (priceMatch) {
                price = parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.'));
              }
            }

            // Fläche (enthält m²)
            else if (text.match(/m²|m2|qm/i) && !area) {
              const areaMatch = text.match(/([\d.,]+)/);
              if (areaMatch) {
                area = parseFloat(areaMatch[1].replace(',', '.'));
              }
            }

            // Zimmer (enthält "Zi")
            else if (text.match(/\d+\s*Zi\.?/i) && !rooms) {
              const roomMatch = text.match(/([\d,]+)/);
              if (roomMatch) {
                rooms = parseFloat(roomMatch[1].replace(',', '.'));
              }
            }
          });

          // Adresse - data-testid="hybridViewAddress" (im Content-Link)
          let address = '';
          const addressEl = contentLink.querySelector('[data-testid="hybridViewAddress"]');
          if (addressEl) {
            address = addressEl.innerText.trim();
          }

          // Bilder - sammle aus ALLEN Links mit dieser ID
          const images = [];
          links.forEach(link => {
            // Galerie-Bilder (class="gallery__image")
            const galleryImgs = link.querySelectorAll('img.gallery__image');
            galleryImgs.forEach(img => {
              const src = img.src || img.getAttribute('data-src');
              if (src && !images.includes(src)) {
                images.push(src);
              }
            });

            // Fallback: Alle pictures.immobilienscout24 Bilder
            if (images.length === 0) {
              const allImgs = link.querySelectorAll('img[src*="pictures.immobilienscout24"]');
              allImgs.forEach(img => {
                const src = img.src;
                if (src && !images.includes(src) && !src.includes('logo') && !src.includes('icon')) {
                  images.push(src);
                }
              });
            }
          });

          // Nur Listings mit Preis
          if (title && price && price > 0) {
            results.push({
              id,
              url,
              title,
              price,
              address,
              area,
              rooms,
              images: images.slice(0, 10), // Max 10 Bilder
            });
          } else if (index < 3) {
            parseErrors.push(`Listing ${id}: title=${!!title}, price=${price}`);
          }
        } catch (e) {
          parseErrors.push(`Listing ${id}: Exception: ${e.message}`);
        }
      });

      debug.parseErrors = parseErrors.slice(0, 10);
      debug.totalProcessed = Object.keys(linksById).length;
      debug.resultsCreated = results.length;

      return { results, debug };
    });

    await page.close();

    const duration = Date.now() - startTime;
    console.log(`✅ Scout24: ${debugInfo.results.length} Ergebnisse in ${duration}ms`);
    console.log(`DEBUG Scout24:`, JSON.stringify(debugInfo.debug, null, 2));

    res.json({
      success: true,
      portal: 'scout24',
      count: debugInfo.results.length,
      duration,
      listings: debugInfo.results,
      debug: debugInfo.debug,
    });

  } catch (err) {
    console.error('❌ Scout24 Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message, portal: 'scout24' });
  }
});

// Scout24 Expose-Details
app.post('/api/scout24-details', async (req, res) => {
  let page = null;

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log('🔍 Scout24 Details:', url);

    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const details = await page.evaluate(() => {
      const text = document.body.innerText;
      const data = {};

      // Wohnfläche
      const wohnMatch = text.match(/Wohnfläche[:\s]*([\d.,]+)\s*m²/i);
      if (wohnMatch) data.wohnflaeche = parseFloat(wohnMatch[1].replace(',', '.'));

      // Grundstück
      const grundMatch = text.match(/Grundstück[:\s]*([\d.,]+)\s*m²/i);
      if (grundMatch) data.grundstueck = parseFloat(grundMatch[1].replace(',', '.'));

      // Zimmer
      const zimMatch = text.match(/Zimmer[:\s]*([\d,]+)/i);
      if (zimMatch) data.zimmer = parseFloat(zimMatch[1].replace(',', '.'));

      // Baujahr
      const bauMatch = text.match(/Baujahr[:\s]*(\d{4})/i);
      if (bauMatch) data.baujahr = parseInt(bauMatch[1]);

      // Heizung
      const heizMatch = text.match(/Heizungsart[:\s]*([^\n,]+)/i);
      if (heizMatch) data.heizung = heizMatch[1].trim();

      // Energieausweis
      const energieMatch = text.match(/Energieeffizienzklasse[:\s]*([A-H]\+?)/i);
      if (energieMatch) data.energieausweis = energieMatch[1];

      // Bilder
      const images = [];
      document.querySelectorAll('img[src*="immobilienscout"]').forEach(img => {
        if (img.src && !images.includes(img.src) && img.width > 100) {
          images.push(img.src);
        }
      });
      data.bilder = images.slice(0, 15);

      return data;
    });

    await page.close();
    res.json({ success: true, details });

  } catch (err) {
    console.error('❌ Scout24 Details Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// IMMOWELT SCRAPING MIT PUPPETEER
// ═══════════════════════════════════════════════════════════════

app.post('/api/immowelt-search', async (req, res) => {
  let page = null;
  const startTime = Date.now();

  try {
    const { city = 'koeln', type = 'haeuser', maxPrice = 500000 } = req.body;

    console.log(`🏠 Immowelt Suche: ${city} - ${type} - max ${maxPrice}€`);

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const searchUrl = `https://www.immowelt.de/suche/${city}/${type}/kaufen?pma=${maxPrice}`;
    console.log('📍 URL:', searchUrl);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Cookie-Banner
    try {
      const cookieBtn = await page.$('[data-testid="uc-accept-all-button"], #acceptAllCookies, .cookie-accept');
      if (cookieBtn) {
        await cookieBtn.click();
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 2000));

    // Immowelt Daten extrahieren - NEUE STRUKTUR (2026)
    const listings = await page.evaluate(() => {
      const results = [];

      // Immowelt verwendet <a data-testid="card-mfe-covering-link-testid">
      // ALLE Daten stehen im title-Attribut!
      const links = document.querySelectorAll('a[data-testid="card-mfe-covering-link-testid"]');

      links.forEach((link, index) => {
        try {
          // Title-Format: "Objektart zum Kauf - Stadtteil, Stadt - PREIS € - X Zimmer, X m², X m² Grundstück"
          const title = link.getAttribute('title') || '';
          if (!title) return;

          const url = link.href;
          const id = url.match(/\/expose\/([^?]+)/)?.[1] || `immowelt-${index}`;

          // Parse title: "Reihenmittelhaus zum Kauf - Köln - 480.000 € - 4 Zimmer, 130 m², 162 m² Grundstück"
          const parts = title.split(' - ');
          if (parts.length < 4) return; // Unvollständig

          const objektart = parts[0].trim(); // "Reihenmittelhaus zum Kauf"
          const location = parts[1]?.trim() || ''; // "Wahn, Köln"
          const priceStr = parts[2]?.trim() || ''; // "480.000 €"
          const details = parts[3]?.trim() || ''; // "4 Zimmer, 130 m², 162 m² Grundstück"

          // Preis extrahieren
          const priceMatch = priceStr.match(/([\d.,]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.')) : null;

          if (!price || price <= 0) return;

          // Zimmer extrahieren
          const roomMatch = details.match(/(\d+)\s*Zimmer/);
          const rooms = roomMatch ? parseInt(roomMatch[1]) : null;

          // Wohnfläche extrahieren (erste m² Angabe)
          const areaMatches = details.match(/(\d+(?:,\d+)?)\s*m²/g);
          let area = null, land = null;
          if (areaMatches && areaMatches.length > 0) {
            area = parseFloat(areaMatches[0].replace(',', '.').replace(/\s*m²/, ''));
            // Zweite m² Angabe = Grundstück
            if (areaMatches.length > 1 && details.includes('Grundstück')) {
              land = parseFloat(areaMatches[1].replace(',', '.').replace(/\s*m²/, ''));
            }
          }

          // Bilder - Container durchsuchen
          const container = link.nextElementSibling || link.parentElement;
          const images = [];
          if (container) {
            const imgs = container.querySelectorAll('img[src*="immowelt"]');
            imgs.forEach(img => {
              const src = img.src;
              if (src && !images.includes(src) && !src.includes('logo')) {
                images.push(src);
              }
            });
          }

          results.push({
            id,
            url,
            title: objektart,
            price,
            address: location,
            area,
            land,
            rooms,
            images: images.slice(0, 5),
          });

        } catch (e) {
          console.error('Immowelt parse error:', e);
        }
      });

      return results;
    });

    await page.close();

    const duration = Date.now() - startTime;
    console.log(`✅ Immowelt: ${listings.length} Ergebnisse in ${duration}ms`);

    res.json({
      success: true,
      portal: 'immowelt',
      count: listings.length,
      duration,
      listings,
    });

  } catch (err) {
    console.error('❌ Immowelt Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message, portal: 'immowelt' });
  }
});

// Immowelt Details
app.post('/api/immowelt-details', async (req, res) => {
  let page = null;

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log('🔍 Immowelt Details:', url);

    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const details = await page.evaluate(() => {
      const text = document.body.innerText;
      const data = {};

      const wohnMatch = text.match(/Wohnfläche[:\s]*([\d.,]+)\s*m²/i);
      if (wohnMatch) data.wohnflaeche = parseFloat(wohnMatch[1].replace(',', '.'));

      const grundMatch = text.match(/Grundstück[:\s]*([\d.,]+)\s*m²/i);
      if (grundMatch) data.grundstueck = parseFloat(grundMatch[1].replace(',', '.'));

      const zimMatch = text.match(/Zimmer[:\s]*([\d,]+)/i);
      if (zimMatch) data.zimmer = parseFloat(zimMatch[1].replace(',', '.'));

      const bauMatch = text.match(/Baujahr[:\s]*(\d{4})/i);
      if (bauMatch) data.baujahr = parseInt(bauMatch[1]);

      const heizMatch = text.match(/Heizung[:\s]*([^\n,]+)/i);
      if (heizMatch) data.heizung = heizMatch[1].trim();

      const images = [];
      document.querySelectorAll('img[src*="immowelt"]').forEach(img => {
        if (img.src && !images.includes(img.src) && img.width > 100) {
          images.push(img.src);
        }
      });
      data.bilder = images.slice(0, 15);

      return data;
    });

    await page.close();
    res.json({ success: true, details });

  } catch (err) {
    console.error('❌ Immowelt Details Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// IMMONET SCRAPING MIT PUPPETEER
// ═══════════════════════════════════════════════════════════════

app.post('/api/immonet-search', async (req, res) => {
  let page = null;
  const startTime = Date.now();

  try {
    const { cityId = 5357, type = 'haus-kaufen', maxPrice = 500000, radius = 50 } = req.body;

    console.log(`🏠 Immonet Suche: cityId=${cityId} - ${type} - max ${maxPrice}€`);

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const searchUrl = `https://www.immonet.de/immobiliensuche/${type}?toprice=${maxPrice}&city=${cityId}&radius=${radius}`;
    console.log('📍 URL:', searchUrl);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Cookie-Banner
    try {
      const cookieBtn = await page.$('#uc-btn-accept-banner, [data-testid="uc-accept-all-button"]');
      if (cookieBtn) {
        await cookieBtn.click();
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 2000));

    const listings = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[data-object-id], .item, article');

      cards.forEach((card, index) => {
        try {
          const id = card.getAttribute('data-object-id') || `immonet-${index}`;

          const linkEl = card.querySelector('a[href*="/expose/"], a[href*="immobilie"]');
          let url = linkEl ? linkEl.href : '';
          if (url && !url.startsWith('http')) url = 'https://www.immonet.de' + url;

          const titleEl = card.querySelector('h2, .item-title, [data-qa="title"]');
          const title = titleEl ? titleEl.innerText.trim() : '';

          const priceEl = card.querySelector('.item-price, [data-qa="price"], .price');
          const priceText = priceEl ? priceEl.innerText : '';
          const priceMatch = priceText.match(/([\d.,]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.')) : null;

          const addressEl = card.querySelector('.item-location, [data-qa="location"], .location');
          const address = addressEl ? addressEl.innerText.trim() : '';

          const areaMatch = card.innerText.match(/([\d.,]+)\s*m²/);
          const area = areaMatch ? parseFloat(areaMatch[1].replace(',', '.')) : null;

          const roomMatch = card.innerText.match(/([\d,]+)\s*Zi/i);
          const rooms = roomMatch ? parseFloat(roomMatch[1].replace(',', '.')) : null;

          const imgEl = card.querySelector('img');
          const image = imgEl ? imgEl.src : null;

          if (price && price > 0) {
            results.push({ id, url, title, price, address, area, rooms, image });
          }
        } catch (e) {}
      });

      return results;
    });

    await page.close();

    const duration = Date.now() - startTime;
    console.log(`✅ Immonet: ${listings.length} Ergebnisse in ${duration}ms`);

    res.json({
      success: true,
      portal: 'immonet',
      count: listings.length,
      duration,
      listings,
    });

  } catch (err) {
    console.error('❌ Immonet Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message, portal: 'immonet' });
  }
});

// Immonet Details
app.post('/api/immonet-details', async (req, res) => {
  let page = null;

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log('🔍 Immonet Details:', url);

    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const details = await page.evaluate(() => {
      const text = document.body.innerText;
      const data = {};

      const wohnMatch = text.match(/Wohnfläche[:\s]*([\d.,]+)\s*m²/i);
      if (wohnMatch) data.wohnflaeche = parseFloat(wohnMatch[1].replace(',', '.'));

      const grundMatch = text.match(/Grundstück[:\s]*([\d.,]+)\s*m²/i);
      if (grundMatch) data.grundstueck = parseFloat(grundMatch[1].replace(',', '.'));

      const zimMatch = text.match(/Zimmer[:\s]*([\d,]+)/i);
      if (zimMatch) data.zimmer = parseFloat(zimMatch[1].replace(',', '.'));

      const bauMatch = text.match(/Baujahr[:\s]*(\d{4})/i);
      if (bauMatch) data.baujahr = parseInt(bauMatch[1]);

      const heizMatch = text.match(/Heizung[:\s]*([^\n,]+)/i);
      if (heizMatch) data.heizung = heizMatch[1].trim();

      const images = [];
      document.querySelectorAll('img').forEach(img => {
        if (img.src && img.width > 100 && !images.includes(img.src)) {
          images.push(img.src);
        }
      });
      data.bilder = images.slice(0, 15);

      return data;
    });

    await page.close();
    res.json({ success: true, details });

  } catch (err) {
    console.error('❌ Immonet Details Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// UNIFIED PORTAL SEARCH (alle Portale auf einmal)
// ═══════════════════════════════════════════════════════════════

app.post('/api/portal-search', async (req, res) => {
  const { portals = ['scout24', 'immowelt'], city = 'koeln', maxPrice = 500000, type = 'house' } = req.body;

  console.log(`🔍 Multi-Portal Suche: ${portals.join(', ')} - ${city} - ${type}`);

  const typeMapping = {
    house: { scout24: 'haus-kaufen', immowelt: 'haeuser', immonet: 'haus-kaufen' },
    apartment: { scout24: 'wohnung-kaufen', immowelt: 'wohnungen', immonet: 'wohnung-kaufen' },
    land: { scout24: 'grundstueck-kaufen', immowelt: 'grundstuecke', immonet: 'grundstueck-kaufen' },
    multi: { scout24: 'mehrfamilienhaus-kaufen', immowelt: 'mehrfamilienhaeuser', immonet: 'mehrfamilienhaus-kaufen' },
  };

  const cityMapping = {
    koeln: { immonetId: 5357 },
    bonn: { immonetId: 3794 },
    duesseldorf: { immonetId: 4389 },
    leverkusen: { immonetId: 5537 },
  };

  const results = {};
  const errors = [];

  for (const portal of portals) {
    try {
      let endpoint, body;

      switch (portal) {
        case 'scout24':
          endpoint = `http://localhost:${PORT}/api/scout24-search`;
          body = { city, type: typeMapping[type]?.scout24 || 'haus-kaufen', maxPrice };
          break;
        case 'immowelt':
          endpoint = `http://localhost:${PORT}/api/immowelt-search`;
          body = { city, type: typeMapping[type]?.immowelt || 'haeuser', maxPrice };
          break;
        case 'immonet':
          endpoint = `http://localhost:${PORT}/api/immonet-search`;
          body = { cityId: cityMapping[city]?.immonetId || 5357, type: typeMapping[type]?.immonet || 'haus-kaufen', maxPrice };
          break;
        default:
          continue;
      }

      const response = await axios.post(endpoint, body, { timeout: 60000 });
      results[portal] = response.data;

    } catch (err) {
      errors.push({ portal, error: err.message });
      results[portal] = { success: false, error: err.message, listings: [] };
    }

    // Pause zwischen Portalen
    await new Promise(r => setTimeout(r, 1000));
  }

  const totalListings = Object.values(results).reduce((sum, r) => sum + (r.listings?.length || 0), 0);

  res.json({
    success: true,
    totalListings,
    results,
    errors,
  });
});

// ═══════════════════════════════════════════════════════════════
// ZVG-PORTAL PROXY (für CORS)
// ═══════════════════════════════════════════════════════════════

app.get('/api/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    });

    res.send(response.data);
  } catch (err) {
    console.error('Proxy Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════
// DEBUG ENDPOINT - Screenshot & HTML-Dump
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

app.post('/api/debug-scrape', async (req, res) => {
  let page = null;

  try {
    const { url, portal = 'test' } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    console.log(`🔍 DEBUG: ${portal} - ${url}`);

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Cookie-Banner wegklicken
    try {
      const cookieSelectors = [
        '#uc-btn-accept-banner',
        '[data-testid="uc-accept-all-button"]',
        '#acceptAllCookies',
        '.cookie-accept',
        'button[title*="akzeptieren"]',
        'button[title*="Akzeptieren"]'
      ];
      for (const sel of cookieSelectors) {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await new Promise(r => setTimeout(r, 1000));
          break;
        }
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 2000));

    // Screenshot speichern
    const debugDir = path.join(__dirname, 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

    const timestamp = Date.now();
    const screenshotPath = path.join(debugDir, `${portal}_${timestamp}.png`);
    const htmlPath = path.join(debugDir, `${portal}_${timestamp}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: false });

    // HTML speichern
    const html = await page.content();
    fs.writeFileSync(htmlPath, html);

    // Seiteninfo extrahieren
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyLength: document.body.innerHTML.length,
        textContent: document.body.innerText.slice(0, 2000),
        possibleCards: {
          'data-item="result"': document.querySelectorAll('[data-item="result"]').length,
          '.result-list-entry': document.querySelectorAll('.result-list-entry').length,
          'article[data-id]': document.querySelectorAll('article[data-id]').length,
          '[data-test="listitem"]': document.querySelectorAll('[data-test="listitem"]').length,
          '.listitem': document.querySelectorAll('.listitem').length,
          '[data-object-id]': document.querySelectorAll('[data-object-id]').length,
          'article': document.querySelectorAll('article').length,
        }
      };
    });

    await page.close();

    console.log(`✅ DEBUG gespeichert: ${screenshotPath}`);

    res.json({
      success: true,
      screenshotPath,
      htmlPath,
      pageInfo
    });

  } catch (err) {
    console.error('❌ DEBUG Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// KLEINANZEIGEN (eBay Kleinanzeigen) SEARCH
// ═══════════════════════════════════════════════════════════════

app.post('/api/kleinanzeigen-search', async (req, res) => {
  let page = null;
  const startTime = Date.now();

  try {
    const { city = 'koeln', maxPrice = 500000 } = req.body;

    console.log(`📦 Kleinanzeigen Suche: ${city} - max ${maxPrice}€`);

    // Kleinanzeigen URL-Struktur: /s-haus-kaufen/{ort}/preis::{maxPrice}/c208l{locationCode}
    // Location Codes für NRW Städte
    const locationCodes = {
      'koeln': '9123',
      'bonn': '9117',
      'duesseldorf': '9414',
      'leverkusen': '9273',
      'bergisch-gladbach': '9121',
      'troisdorf': '9347',
      'siegburg': '9335',
      'pulheim': '9305',
      'huerth': '9243',
      'bruehl': '9139',
    };

    const locationCode = locationCodes[city] || '9123'; // Default: Köln
    const searchUrl = `https://www.kleinanzeigen.de/s-haus-kaufen/${city}/preis::${maxPrice}/c208l${locationCode}`;

    console.log('📍 URL:', searchUrl);

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Stealth-Mode: Webdriver-Detection umgehen
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Längerer Timeout & weniger strikte Bedingung für Kleinanzeigen
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Cookie-Banner wegklicken falls vorhanden
    try {
      const cookieBtn = await page.$('#gdpr-banner-accept, [data-testid="gdpr-banner-cta-button"]');
      if (cookieBtn) {
        await cookieBtn.click();
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {}

    await new Promise(r => setTimeout(r, 2000));

    // Kleinanzeigen Daten extrahieren
    const listings = await page.evaluate(() => {
      const results = [];

      // Kleinanzeigen verwendet <article class="aditem">
      const articles = document.querySelectorAll('article.aditem');

      articles.forEach((article, index) => {
        try {
          const id = article.getAttribute('data-adid') || `kleinanzeigen-${index}`;
          const href = article.getAttribute('data-href') || '';
          const url = href ? `https://www.kleinanzeigen.de${href}` : '';

          // Titel - <h2> mit <a> Link
          const titleLink = article.querySelector('h2 a.ellipsis');
          const title = titleLink ? titleLink.innerText.trim() : '';

          // Preis - class enthält "price"
          const priceEl = article.querySelector('[class*="price"]');
          const priceText = priceEl ? priceEl.innerText.trim() : '';
          const priceMatch = priceText.match(/([\d.,]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.')) : null;

          if (!price || price <= 0) return; // Kein Preis = Skip

          // Beschreibung
          const descEl = article.querySelector('[class*="description"]');
          const description = descEl ? descEl.innerText.trim() : '';

          // Fläche & Zimmer aus simpletag spans
          const tags = article.querySelectorAll('.simpletag');
          let area = null, rooms = null;

          tags.forEach(tag => {
            const text = tag.innerText.trim();

            // Fläche (m²)
            if (text.match(/m²/i)) {
              const areaMatch = text.match(/([\d.,]+)/);
              if (areaMatch) area = parseFloat(areaMatch[1].replace(',', '.'));
            }

            // Zimmer (Zi.)
            else if (text.match(/Zi\./i)) {
              const roomMatch = text.match(/([\d,]+)/);
              if (roomMatch) rooms = parseFloat(roomMatch[1].replace(',', '.'));
            }
          });

          // Bilder - im imagebox
          const images = [];
          const imgElements = article.querySelectorAll('img[src*="kleinanzeigen.de"]');
          imgElements.forEach(img => {
            const src = img.src;
            if (src && !images.includes(src) && !src.includes('placeholder')) {
              images.push(src);
            }
          });

          // Ort - meist im alt-Text oder separatem Element
          let address = '';
          const altText = article.querySelector('img')?.alt || '';
          const locationMatch = altText.match(/[-–]\s*([^-–]+)$/);
          if (locationMatch) {
            address = locationMatch[1].trim();
          }

          results.push({
            id,
            url,
            title,
            price,
            address,
            area,
            rooms,
            description: description.substring(0, 200),
            images: images.slice(0, 5),
          });

        } catch (e) {
          console.error('Kleinanzeigen parse error:', e);
        }
      });

      return results;
    });

    await page.close();

    const duration = Date.now() - startTime;
    console.log(`✅ Kleinanzeigen: ${listings.length} Ergebnisse in ${duration}ms`);

    res.json({
      success: true,
      portal: 'kleinanzeigen',
      count: listings.length,
      duration,
      listings,
    });

  } catch (err) {
    console.error('❌ Kleinanzeigen Error:', err.message);
    if (page) await page.close().catch(() => {});
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SERVER STARTEN
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     ZVG Backend Server gestartet           ║
║     Port: ${PORT}                              ║
║                                            ║
║     Endpoints:                             ║
║     POST /api/parse-pdf   - PDF parsen     ║
║     GET  /api/proxy       - CORS Proxy     ║
║     GET  /api/health      - Health Check   ║
╚════════════════════════════════════════════╝
  `);
});
