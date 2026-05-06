import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../../config.js';
import type { Provider, ProviderResult } from '../../types/common.js';

const PROVIDER_NAME = 'tellows';

export const tellows: Provider = {
  name: PROVIDER_NAME,
  isAvailable() {
    return true;
  },

  async lookup(query: string): Promise<ProviderResult> {
    const start = Date.now();
    try {
      // Query is already normalized to 0049xxx format — use directly
      const num = query;

      if (config.tellowsApiKey) {
        return await lookupApi(num, start);
      }
      return await lookupScrape(num, start);
    } catch (error) {
      return {
        provider: PROVIDER_NAME,
        success: false,
        data: {},
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - start,
      };
    }
  },
};

async function lookupApi(num: string, start: number): Promise<ProviderResult> {
  // API uses national format (0xxx)
  const apiNum = num.replace(/^0049/, '0').replace(/^00/, '');
  const url = `https://www.tellows.de/basic/num/${apiNum}?json=1&partner=${config.tellowsApiKey}`;
  const resp = await axios.get(url, { timeout: config.providerTimeout });
  const raw = resp.data;
  const tel = raw?.tellows;
  if (!tel) {
    return {
      provider: PROVIDER_NAME,
      success: false,
      data: {},
      raw,
      error: 'No data returned',
      duration: Date.now() - start,
    };
  }
  return {
    provider: PROVIDER_NAME,
    success: true,
    data: {
      tellows_score: tel.score ? parseInt(tel.score, 10) : undefined,
      tellows_score_color: tel.scoreColor,
      caller_type: tel.callerType?.name,
      caller_type_id: tel.callerType?.id,
      name: tel.callerName,
      city: tel.location,
      country: tel.country,
      comments_count: tel.comments ? parseInt(tel.comments, 10) : undefined,
      searches_count: tel.searches ? parseInt(tel.searches, 10) : undefined,
    },
    raw,
    duration: Date.now() - start,
  };
}

async function lookupScrape(num: string, start: number): Promise<ProviderResult> {
  const url = `https://www.tellows.de/num/${encodeURIComponent(num)}`;
  const resp = await axios.get(url, {
    timeout: config.providerTimeout,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    },
  });
  const $ = cheerio.load(resp.data);
  const html = $.html();
  const data: Record<string, unknown> = {};

  // --- Score ---
  const scoreImg = $('img.scoreimage').first();
  if (scoreImg.length) {
    const alt = scoreImg.attr('alt') || '';
    const src = scoreImg.attr('src') || '';
    const altMatch = alt.match(/Score\s+(\d+)/i);
    const srcMatch = src.match(/s(\d+)\.jpg/);
    if (altMatch) data.tellows_score = parseInt(altMatch[1], 10);
    else if (srcMatch) data.tellows_score = parseInt(srcMatch[1], 10);
  }

  // --- Caller Name (from h1 or .callerId) ---
  const callerIdEl = $('span.callerId').first();
  if (callerIdEl.length) {
    const name = callerIdEl.text().trim();
    if (name) data.name = name;
  } else {
    // Fallback: extract from <h1>
    const h1Text = $('h1').first().text().trim();
    const h1Name = h1Text.replace(/\s*[\d+/\s]+$/, '').trim();
    if (h1Name && h1Name.length > 2) data.name = h1Name;
  }

  // --- Call Type (Anruftypen) ---
  const callTypeMatch = html.match(
    /<b><a href="#userratings">Anruftypen:<\/a><\/b>\s*\n?\s*([^<]+)/,
  );
  if (callTypeMatch) {
    data.caller_type = callTypeMatch[1].trim();
  }

  // --- Phone Details Card ---
  const cityMatch = html.match(/<strong>Stadt:\s*<\/strong>([^<]+)/);
  if (cityMatch) {
    const parts = cityMatch[1].trim().split(/\s*-\s*/);
    data.city = parts[0];
    if (parts.length > 1) data.country = parts[parts.length - 1];
  }

  const phoneMatch = html.match(/<strong>Telefonnummer:\s*<\/strong>\s*<span>([^<]+)/);
  if (phoneMatch) data.phone_formatted = phoneMatch[1].trim();

  // --- Bewertungen (Comments Count) ---
  const ratingsMatch = html.match(/Bewertungen:\s*<span>(\d+)<\/span>/);
  if (ratingsMatch) data.comments_count = parseInt(ratingsMatch[1], 10);

  // --- Suchanfragen (Searches Count) ---
  const searchesMatch = html.match(/Suchanfragen:\s*\n?\s*(\d+)/);
  if (searchesMatch) data.searches_count = parseInt(searchesMatch[1], 10);

  // --- Assessment (Einschätzung) ---
  const assessMatch = html.match(/<strong>Einsch[^<]*<\/strong>\s*\n?\s*([^<]+)/);
  if (assessMatch) {
    const assessment = assessMatch[1].trim();
    if (assessment) data.assessment = assessment;
  }

  // --- Call Type Distribution Table ---
  const callTypes: { type: string; count: number }[] = [];
  $('h5:contains("Anruftypen")')
    .closest('.col-md-4')
    .find('table.table-rating tr')
    .each((_, row) => {
      const th = $(row).find('th');
      if (th.length) {
        const typeText = th.contents().first().text().trim();
        const countMatch = th.find('span.small').text().match(/(\d+)/);
        if (typeText && countMatch) {
          callTypes.push({ type: typeText, count: parseInt(countMatch[1], 10) });
        }
      }
    });
  if (callTypes.length > 0) data.call_types = callTypes;

  // --- Caller Names Distribution Table ---
  const callerNames: { name: string; count: number }[] = [];
  $('h5:contains("Anrufername")')
    .closest('.col-md-4')
    .find('table.table-rating tr')
    .each((_, row) => {
      const th = $(row).find('th');
      if (th.length) {
        const nameText = th.contents().first().text().trim();
        const countMatch = th.find('span.small').text().match(/(\d+)/);
        if (nameText && countMatch) {
          callerNames.push({ name: nameText, count: parseInt(countMatch[1], 10) });
        }
      }
    });
  if (callerNames.length > 0) data.caller_names = callerNames;

  // --- Trends ---
  const lastCallMatch = html.match(/<strong>Letzter Anruf<\/strong>:\s*([^<]+)/);
  if (lastCallMatch) data.last_call = lastCallMatch[1].trim();

  const viewsMatch = html.match(/Aufrufe letzter Monat<\/strong>:\s*(\d+)/);
  if (viewsMatch) data.monthly_views = parseInt(viewsMatch[1], 10);

  const blocklistMatch = html.match(/Nr\.\s*(\d+)\s*in Sperrliste/);
  if (blocklistMatch) data.blocklist_position = parseInt(blocklistMatch[1], 10);

  // --- Area Code Details ---
  const areaCodeCard = $('h4:contains("Vorwahl")').first();
  if (areaCodeCard.length) {
    const areaTitle = areaCodeCard
      .text()
      .trim()
      .replace(/^Vorwahl\s*/, '');
    if (areaTitle) data.area_name = areaTitle;
  }

  const cityScoreMatch = html.match(/tellows Score der Stadt:<\/b>\s*([\d.]+)/);
  if (cityScoreMatch) data.city_score = parseFloat(cityScoreMatch[1]);

  const areaCodeMatch = html.match(/<b>Vorwahl:<\/b>\s*(\d+)/);
  if (areaCodeMatch) data.area_code = areaCodeMatch[1];

  const postalMatch = html.match(/<b>Postleitzahl:<\/b>\s*(\d+)/);
  if (postalMatch) data.postal_code = postalMatch[1];

  const populationMatch = html.match(/<b>Einwohner:<\/b>\s*([\d]+)/);
  if (populationMatch) data.population = parseInt(populationMatch[1], 10);

  // --- Comments ---
  const comments: { text: string; date?: string; score?: number; author?: string }[] = [];
  $('#singlecomments > li').each((_, li) => {
    const el = $(li);
    const text = el.find('p.mb-0').first().text().trim();
    if (!text) return;

    const meta = el.find('.comment-meta').first().text().trim();
    const scoreClass = el.find('[class*="realscore"]').first().attr('class') || '';
    const scoreMatch = scoreClass.match(/realscore(\d+)/);
    const authorEl = el.find('p.lead a, p.lead').first();
    // Author is either link text or the lead paragraph text before "schrieb:"
    let author: string | undefined;
    const leadText = el.find('p.lead').first().text().trim();
    const authorMatch = leadText.match(/^(.+?)\s+schrieb:/);
    if (authorMatch) author = authorMatch[1].trim();
    else if (authorEl.is('a')) author = authorEl.text().trim();

    comments.push({
      text,
      date: meta.split(/\s{2,}/)[0]?.trim() || undefined,
      score: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
      author: author || undefined,
    });
  });

  if (comments.length > 0) {
    data.comments = comments;
  } else {
    // Fallback: extract from the latest comment card in the details section
    const fallbackEl = $('b:contains("Neuster Kommentar")').closest('div');
    if (fallbackEl.length) {
      const fbText = fallbackEl
        .find('p.callerinfo')
        .first()
        .text()
        .trim()
        .replace(/alle Bewertungen$/, '')
        .trim();
      const fbDateMatch = fallbackEl.text().match(/\((\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2})\)/);
      if (fbText) {
        data.comments = [
          {
            text: fbText.replace(/^.*?schrieb:\s*/, '').trim(),
            date: fbDateMatch ? fbDateMatch[1] : undefined,
          },
        ];
      }
    }
  }

  return {
    provider: PROVIDER_NAME,
    success: Object.keys(data).length > 0,
    data,
    raw: resp.data,
    error: Object.keys(data).length === 0 ? 'Could not parse any data from page' : undefined,
    duration: Date.now() - start,
  };
}
