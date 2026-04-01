import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { RawLead } from '../types';

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
          const title     = reviewEl.find('h3, [data-testid="review-title"]').first().text().trim();
          const text      = reviewEl.find('p, [data-testid="review-body"]').first().text().trim();
          const author    = reviewEl.find('[data-testid="reviewer-name"], .reviewer-name').first().text().trim() || 'anonymous';
          const dateStr   = reviewEl.find('time').first().attr('datetime') ?? '';
          const hrefEl    = reviewEl.find('a[href*="/reviews/"]').first();
          const href      = hrefEl.attr('href') ?? '';
          const reviewUrl = href.startsWith('http') ? href : `https://www.capterra.com${href}`;

          if (!text || text.length < 30 || seen.has(reviewUrl || url)) return;
          seen.add(reviewUrl || url);

          leads.push({
            url:       reviewUrl || url,
            source:    'capterra',
            author:    author || 'anonymous',
            text,
            title:     title || undefined,
            createdAt: dateStr ? new Date(dateStr) : new Date(),
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
