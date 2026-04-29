import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { RawLead } from '../types';
import { sanitizeText, isValidHttpUrl, parseDate } from '../utils/dataQuality';

const DEFAULT_QUERIES = [
  'monday.com',
  'asana',
  'clickup',
  'project management software',
  'team collaboration tool',
];

const G2_SEARCH_BASE = 'https://www.g2.com/search#query=';

export async function scrape(queries: string[] = DEFAULT_QUERIES): Promise<RawLead[]> {
  const leads: RawLead[] = [];
  const seen  = new Set<string>();

  const browser = await chromium.launch({ headless: true });

  try {
    for (const query of queries) {
      const page = await browser.newPage();

      // Stealth: set a realistic user-agent
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });

      const url = `${G2_SEARCH_BASE}${encodeURIComponent(query)}`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const html = await page.content();
        const $    = cheerio.load(html);

        // G2 review cards
        $('[itemprop="review"], .paper.paper--white.paper--box').each((_, el) => {
          const reviewEl   = $(el);
          const title      = sanitizeText(reviewEl.find('[itemprop="name"], .review-title').first().text());
          const text       = sanitizeText(reviewEl.find('[itemprop="reviewBody"], .review-text').first().text());
          const author     = sanitizeText(reviewEl.find('[itemprop="author"], .reviewer-name').first().text()) || 'anonymous';
          const dateStr    = reviewEl.find('[itemprop="datePublished"], time').first().attr('datetime') ?? '';
          const hrefEl     = reviewEl.find('a[href*="/reviews/"]').first();
          const href       = hrefEl.attr('href') ?? '';

          // Skip reviews without a stable per-review URL — using a search page
          // URL as the lead URL produces misleading and non-unique data.
          if (!href) return;
          const reviewUrl  = href.startsWith('http') ? href : `https://www.g2.com${href}`;
          if (!isValidHttpUrl(reviewUrl) || seen.has(reviewUrl)) return;

          if (!text || text.length < 30) return;
          seen.add(reviewUrl);

          leads.push({
            url:       reviewUrl,
            source:    'g2',
            author,
            text,
            title:     title || undefined,
            createdAt: parseDate(dateStr),
            query,
          });
        });

        console.log(`[g2] "${query}" → ${leads.length} total leads so far`);
      } catch (err) {
        console.warn(`[g2] "${query}" failed:`, err);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return leads;
}
