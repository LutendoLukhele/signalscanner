import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { RawLead } from '../types';
import { sanitizeText, isValidHttpUrl, parseDate } from '../utils/dataQuality';

const DEFAULT_QUERIES = [
  'Monday.com broken',
  'Asana alternatives',
  'ClickUp not working',
  'project management frustrating',
  'switching project management tool',
];

function getNitterInstances(): string[] {
  const raw = process.env.NITTER_INSTANCES ?? 'nitter.net';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function scrape(queries: string[] = DEFAULT_QUERIES): Promise<RawLead[]> {
  const instances = getNitterInstances();
  const leads: RawLead[] = [];
  const seen  = new Set<string>();

  const browser = await chromium.launch({ headless: true });

  try {
    for (const query of queries) {
      // Try each instance, use first that succeeds
      for (const instance of instances) {
        const url = `https://${instance}/search?q=${encodeURIComponent(query)}&f=tweets`;
        const page = await browser.newPage();

        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          const html = await page.content();
          const $    = cheerio.load(html);

          $('.timeline-item').each((_, el) => {
            const tweetEl  = $(el);
            const text     = sanitizeText(tweetEl.find('.tweet-content').text());
            const author   = sanitizeText(tweetEl.find('.username').first().text().replace('@', ''));
            const dateStr  = tweetEl.find('.tweet-date a').attr('title') ?? '';
            const href     = tweetEl.find('.tweet-date a').attr('href') ?? '';

    // Require a real tweet path (/status/<numeric-id>) so the constructed URL is valid
            if (!href || !/\/status\/\d+/.test(href)) return;
            const tweetUrl = `https://twitter.com${href}`;
            if (!isValidHttpUrl(tweetUrl) || seen.has(tweetUrl)) return;

            if (!text || text.length < 20) return;
            seen.add(tweetUrl);

            leads.push({
              url:       tweetUrl,
              source:    'twitter',
              author,
              text,
              createdAt: parseDate(dateStr),
              query,
            });
          });

          console.log(`[twitter] ${instance} "${query}" → ${leads.length} total leads so far`);
          break; // instance succeeded
        } catch (err) {
          console.warn(`[twitter] ${instance} "${query}" failed:`, err);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  return leads;
}
