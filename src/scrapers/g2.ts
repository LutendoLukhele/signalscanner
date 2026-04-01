import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { RawLead } from '../types';

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
          const title      = reviewEl.find('[itemprop="name"], .review-title').first().text().trim();
          const text       = reviewEl.find('[itemprop="reviewBody"], .review-text').first().text().trim();
          const author     = reviewEl.find('[itemprop="author"], .reviewer-name').first().text().trim() || 'anonymous';
          const dateStr    = reviewEl.find('[itemprop="datePublished"], time').first().attr('datetime') ?? '';
          const hrefEl     = reviewEl.find('a[href*="/reviews/"]').first();
          const href       = hrefEl.attr('href') ?? '';
          const reviewUrl  = href.startsWith('http') ? href : `https://www.g2.com${href}`;

          if (!text || text.length < 30 || seen.has(reviewUrl)) return;
          seen.add(reviewUrl);

          leads.push({
            url:       reviewUrl || url,
            source:    'g2',
            author:    author || 'anonymous',
            text,
            title:     title || undefined,
            createdAt: dateStr ? new Date(dateStr) : new Date(),
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
