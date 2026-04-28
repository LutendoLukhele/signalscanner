import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { RawLead } from '../types';
import { sanitizeText, isValidHttpUrl, parseDate } from '../utils/dataQuality';

const DEFAULT_QUERIES = [
  'monday.com',
  'asana',
  'clickup',
  'project management',
  'team collaboration',
];

const CAPTERRA_BASE = 'https://www.capterra.com/search/#q=';

export async function scrape(queries: string[] = DEFAULT_QUERIES): Promise<RawLead[]> {
  const leads: RawLead[] = [];
  const seen  = new Set<string>();

  const browser = await chromium.launch({ headless: true });

  try {
    for (const query of queries) {
      const page = await browser.newPage();

      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });

      const url = `${CAPTERRA_BASE}${encodeURIComponent(query)}`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const html = await page.content();
        const $    = cheerio.load(html);

        // Capterra review cards
        $('[data-testid="review-card"], .review-card, article').each((_, el) => {
          const reviewEl  = $(el);
          const title     = sanitizeText(reviewEl.find('h3, [data-testid="review-title"]').first().text());
          const text      = sanitizeText(reviewEl.find('p, [data-testid="review-body"]').first().text());
          const author    = sanitizeText(reviewEl.find('[data-testid="reviewer-name"], .reviewer-name').first().text()) || 'anonymous';
          const dateStr   = reviewEl.find('time').first().attr('datetime') ?? '';
          const hrefEl    = reviewEl.find('a[href*="/reviews/"]').first();
          const href      = hrefEl.attr('href') ?? '';

          // Skip reviews without a stable per-review URL — using the search
          // page URL as both the lead URL and dedup key causes all subsequent
          // URL-less reviews on the same page to be silently dropped.
          if (!href) return;
          const reviewUrl = href.startsWith('http') ? href : `https://www.capterra.com${href}`;
          if (!isValidHttpUrl(reviewUrl) || seen.has(reviewUrl)) return;

          if (!text || text.length < 30) return;
          seen.add(reviewUrl);

          leads.push({
            url:       reviewUrl,
            source:    'capterra',
            author,
            text,
            title:     title || undefined,
            createdAt: parseDate(dateStr),
            query,
          });
        });

        console.log(`[capterra] "${query}" → ${leads.length} total leads so far`);
      } catch (err) {
        console.warn(`[capterra] "${query}" failed:`, err);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return leads;
}
