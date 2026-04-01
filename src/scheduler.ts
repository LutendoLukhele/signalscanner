import * as reddit   from './scrapers/reddit';
import * as twitter  from './scrapers/twitter';
import * as g2       from './scrapers/g2';
import * as capterra from './scrapers/capterra';
import * as linkedin from './scrapers/linkedin';
import { scoreLeads } from './scorer';
import { upsertLead, startScan, finishScan } from './db';
import { RawLead, ScoredLead } from './types';
import { scanBus } from './scanEvents';

/** Run a scraper and emit a progress event when it settles */
async function runScraper(name: string, fn: () => Promise<RawLead[]>): Promise<RawLead[]> {
  try {
    const leads = await fn();
    scanBus.emit('scan', { type: 'progress', scraper: name, count: leads.length });
    return leads;
  } catch (err) {
    scanBus.emit('scan', { type: 'progress', scraper: name, count: 0 });
    throw err;
  }
}

export async function runScan(): Promise<ScoredLead[]> {
  console.log('[scanner] Starting scan…');
  const scanId = startScan();

  try {
    const raw = (await Promise.allSettled([
      runScraper('reddit',   reddit.scrape),
      runScraper('twitter',  twitter.scrape),
      runScraper('g2',       g2.scrape),
      runScraper('capterra', capterra.scrape),
      runScraper('linkedin', linkedin.scrape),
    ])).flatMap(result => {
      if (result.status === 'fulfilled') return result.value;
      console.error('[scanner] Scraper error:', result.reason);
      return [];
    });

    console.log(`[scanner] Raw leads collected: ${raw.length}`);

    const scored = await scoreLeads(raw);

    for (const lead of scored) {
      upsertLead(lead);
    }

    finishScan(scanId, scored.length);
    console.log(`[scanner] Scan complete. Persisted ${scored.length} leads.`);
    scanBus.emit('scan', { type: 'done', total: scored.length });

    return scored;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    scanBus.emit('scan', { type: 'error', message });
    throw err;
  }
}
