import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { RawLead } from '../types';

interface CapterraProduct {
  slug:    string;
  display: string;
}

// Direct Capterra review pages.
// Slug format: verify at https://www.capterra.com/reviews/{slug}/
const PRODUCTS: CapterraProduct[] = [
  { slug: 'monday-com', display: 'monday.com' },
  { slug: 'asana',      display: 'Asana'      },
  { slug: 'clickup',    display: 'ClickUp'    },
];

/** Extract the "Cons" text from a Capterra review element. */
function extractConsText($: cheerio.CheerioAPI, reviewEl: cheerio.Cheerio<AnyNode>): string {
  // Try dedicated cons container (newer Capterra HTML)
  const consContainer = reviewEl
    .find('[data-testid*="cons"], [class*="cons"], [data-entity*="con"]')
    .first();
  if (consContainer.length) {
    const t = consContainer.text().trim();
    if (t.length > 40) return t;
  }

  // Heading-based: find "Cons" / "Dislik" / "Improv" label then grab adjacent paragraph
  let text = '';
  reviewEl.find('strong, h4, label, [class*="label"]').each((_, lbl) => {
    if (text) return; // already found
    const lblText = $(lbl).text().toLowerCase();
    if (lblText.includes('con') || lblText.includes('dislik') || lblText.includes('improv')) {
      const next =
        $(lbl).parent().find('p').last().text().trim() ||
        $(lbl).nextAll('p').first().text().trim();
      if (next.length > 40) text = next;
    }
  });
  if (text) return text;

  // Fall back to the first substantial paragraph in the card
  reviewEl.find('p').each((_, p) => {
    if (text) return;
    const t = $(p).text().trim();
    if (t.length > 60) text = t;
  });
  return text;
}

export async function scrape(): Promise<RawLead[]> {
  const leads: RawLead[] = [];
  const seen  = new Set<string>();

  const browser = await chromium.launch({ headless: true });

  try {
    for (const product of PRODUCTS) {
      const page = await browser.newPage();

      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });

      const url = `https://www.capterra.com/reviews/${product.slug}/?sort=recent`;

      try {
        // networkidle ensures JS-rendered review cards are present
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });

        await page.waitForSelector('article, [data-testid="review-card"], .review-card', { timeout: 10_000 })
          .catch(() => {
            console.warn(`[capterra] "${product.display}" — review selector not found; HTML may have changed`);
          });

        const html = await page.content();
        const $    = cheerio.load(html);

        $('article, [data-testid="review-card"], .review-card').each((_, el) => {
          const reviewEl  = $(el);
          const text      = extractConsText($, reviewEl);
          const title     = reviewEl.find('h3, [data-testid="review-title"]').first().text().trim();
          const author    = reviewEl.find('[data-testid="reviewer-name"], .reviewer-name, [class*="reviewer"]').first().text().trim() || 'anonymous';
          const dateStr   = reviewEl.find('time').first().attr('datetime') ?? '';
          const href      = reviewEl.find('a[href*="/reviews/"]').first().attr('href') ?? '';
          const reviewUrl = href.startsWith('http') ? href : `https://www.capterra.com${href}`;

          if (!text || text.length < 40 || seen.has(reviewUrl || url)) return;
          seen.add(reviewUrl || url);

          leads.push({
            url:       reviewUrl || url,
            source:    'capterra',
            author,
            text,
            title:     title || product.display,
            createdAt: dateStr ? new Date(dateStr) : new Date(),
            query:     product.display,
          });
        });

        console.log(`[capterra] "${product.display}" → ${leads.length} total leads so far`);
      } catch (err) {
        console.warn(`[capterra] "${product.display}" failed:`, err);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return leads;
}
