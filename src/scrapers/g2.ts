import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { RawLead } from '../types';

interface G2Product {
  slug:    string;
  display: string;
}

// Direct product review pages filtered to 1-2 star reviews for maximum pain signal.
// G2 product slugs: verify at https://www.g2.com/products/{slug}/reviews
const PRODUCTS: G2Product[] = [
  { slug: 'monday',  display: 'monday.com' },
  { slug: 'asana',   display: 'Asana'      },
  { slug: 'clickup', display: 'ClickUp'    },
];

function buildReviewUrl(slug: string): string {
  // 1-star and 2-star reviews only — highest pain signal
  return (
    `https://www.g2.com/products/${slug}/reviews` +
    `?filters%5Border%5D=most_recent` +
    `&filters%5Bstar_filter%5D%5B%5D=1` +
    `&filters%5Bstar_filter%5D%5B%5D=2`
  );
}

/** Extract the "Cons / What do you dislike?" text from a review element. */
function extractConsText($: cheerio.CheerioAPI, reviewEl: cheerio.Cheerio<AnyNode>): string {
  // Try dedicated cons container first (newer G2 HTML)
  const consContainer = reviewEl.find('[data-test*="con"], [class*="cons"], [data-type="con"]').first();
  if (consContainer.length) {
    const t = consContainer.text().trim();
    if (t.length > 40) return t;
  }

  // Try heading-based extraction: find "dislike" / "cons" headings then grab next paragraph
  let text = '';
  reviewEl.find('h3, h4, strong').each((_, h) => {
    if (text) return; // already found
    const hText = $(h).text().toLowerCase();
    if (hText.includes('dislike') || hText.includes('cons') || hText.includes('improv')) {
      const next = $(h).nextAll('p, div').first().text().trim();
      if (next.length > 40) text = next;
    }
  });
  if (text) return text;

  // Fall back to the main review body
  return reviewEl
    .find('[itemprop="reviewBody"], .formatted-text, .review-text, p')
    .first()
    .text()
    .trim();
}

export async function scrape(): Promise<RawLead[]> {
  const leads: RawLead[] = [];
  const seen  = new Set<string>();

  const browser = await chromium.launch({ headless: true });

  try {
    for (const product of PRODUCTS) {
      const page = await browser.newPage();

      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });

      const url = buildReviewUrl(product.slug);

      try {
        // networkidle ensures JS-rendered review cards are present
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });

        // Give React time to hydrate; log a warning if not found but continue
        await page.waitForSelector('[itemprop="review"], .paper, .review-tile', { timeout: 10_000 })
          .catch(() => {
            console.warn(`[g2] "${product.display}" — review selector not found; HTML may have changed`);
          });

        const html = await page.content();
        const $    = cheerio.load(html);

        $('[itemprop="review"], .paper.paper--white.paper--box, .review-tile').each((_, el) => {
          const reviewEl  = $(el);
          const text      = extractConsText($, reviewEl);
          const title     = reviewEl.find('[itemprop="name"], .review-title, h3').first().text().trim();
          const author    = reviewEl.find('[itemprop="author"], .reviewer-name').first().text().trim() || 'anonymous';
          const dateStr   = reviewEl.find('[itemprop="datePublished"], time').first().attr('datetime') ?? '';
          const href      = reviewEl.find('a[href*="/reviews/"]').first().attr('href') ?? '';
          const reviewUrl = href.startsWith('http') ? href : `https://www.g2.com${href}`;

          if (!text || text.length < 40 || seen.has(reviewUrl)) return;
          seen.add(reviewUrl);

          leads.push({
            url:       reviewUrl || url,
            source:    'g2',
            author,
            text,
            title:     title || product.display,
            createdAt: dateStr ? new Date(dateStr) : new Date(),
            query:     product.display,
          });
        });

        console.log(`[g2] "${product.display}" → ${leads.length} total leads so far`);
      } catch (err) {
        console.warn(`[g2] "${product.display}" failed:`, err);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  return leads;
}
