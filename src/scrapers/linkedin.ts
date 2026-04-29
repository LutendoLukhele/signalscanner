/**
 * LinkedIn scraper — optional and fragile.
 * LinkedIn aggressively blocks scrapers; only enable if you accept the risk.
 * Set LINKEDIN_ENABLED=true in .env to activate.
 */
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { RawLead } from '../types';
import { sanitizeText, isValidHttpUrl } from '../utils/dataQuality';

const DEFAULT_QUERIES = [
  'looking for project management alternative',
  'frustrated with Monday.com',
  'switching from Asana',
];

export async function scrape(queries: string[] = DEFAULT_QUERIES): Promise<RawLead[]> {
  if (process.env.LINKEDIN_ENABLED !== 'true') {
    console.log('[linkedin] Skipped — set LINKEDIN_ENABLED=true in .env to enable');
    return [];
  }

  const leads: RawLead[] = [];
  const seen  = new Set<string>();

  const browser = await chromium.launch({ headless: true });

  try {
    for (const query of queries) {
      const page = await browser.newPage();

      // Stealth headers
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      });

      const url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&sortBy=date_posted`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

        // Wait for login wall or content
        await page.waitForTimeout(2000);

        const html = await page.content();

        // If redirected to login, bail
        if (html.includes('authwall') || html.includes('login')) {
          console.warn('[linkedin] Hit auth wall — LinkedIn scraping requires a logged-in session');
          await page.close();
          break;
        }

        const $ = cheerio.load(html);

        $('.feed-shared-update-v2, .occludable-update').each((_, el) => {
          const postEl  = $(el);
          const text    = sanitizeText(postEl.find('.feed-shared-text, .update-components-text').first().text());
          const author  = sanitizeText(postEl.find('.feed-shared-actor__name, .update-components-actor__name').first().text()) || 'anonymous';
          const href    = postEl.find('a.app-aware-link[href*="/posts/"]').first().attr('href') ?? '';
          const postUrl = href.split('?')[0];

          // Require a stable per-post URL so the lead is addressable
          if (!postUrl || !isValidHttpUrl(postUrl) || seen.has(postUrl)) return;

          if (!text || text.length < 30) return;
          seen.add(postUrl);

          leads.push({
            url:       postUrl,
            source:    'linkedin',
            author,
            text,
            createdAt: new Date(),
            query,
          });
        });

        console.log(`[linkedin] "${query}" → ${leads.length} total leads so far`);
      } catch (err) {
        console.warn(`[linkedin] "${query}" failed:`, err);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return leads;
}
