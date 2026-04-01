import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { RawLead } from '../types';

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
            const text     = tweetEl.find('.tweet-content').text().trim();
            const author   = tweetEl.find('.username').first().text().replace('@', '').trim();
            const dateStr  = tweetEl.find('.tweet-date a').attr('title') ?? '';
            const href     = tweetEl.find('.tweet-date a').attr('href') ?? '';
            const tweetUrl = `https://twitter.com${href}`;

            if (!text || text.length < 20 || !href || seen.has(tweetUrl)) return;
            seen.add(tweetUrl);

            leads.push({
              url:       tweetUrl,
              source:    'twitter',
              author,
              text,
              createdAt: dateStr ? new Date(dateStr) : new Date(),
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
