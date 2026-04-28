import * as reddit   from './scrapers/reddit';
import * as twitter  from './scrapers/twitter';
import * as g2       from './scrapers/g2';
import * as capterra from './scrapers/capterra';
import * as linkedin from './scrapers/linkedin';
import { scoreLeads } from './scorer';
import { upsertLead, startScan, finishScan } from './db';
import { ScoredLead } from './types';

export async function runScan(): Promise<ScoredLead[]> {
  console.log('[scanner] Starting scan…');
  const scanId = startScan();

  const raw = (await Promise.allSettled([
    reddit.scrape(),
    twitter.scrape(),
    g2.scrape(),
    capterra.scrape(),
    linkedin.scrape(),
  ])).flatMap(result => {
    if (result.status === 'fulfilled') return result.value;
    console.error('[scanner] Scraper error:', result.reason);
    return [];
  });

  console.log(`[scanner] Raw leads collected: ${raw.length}`);

  // Deduplicate by URL across all sources before scoring
  const seen = new Set<string>();
  const deduped = raw.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
  if (deduped.length < raw.length) {
    console.log(`[scanner] Deduped to ${deduped.length} unique leads`);
  }

  const scored = await scoreLeads(deduped);

  for (const lead of scored) {
    upsertLead(lead);
  }

  finishScan(scanId, scored.length);
  console.log(`[scanner] Scan complete. Persisted ${scored.length} leads.`);

  return scored;
}
