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

/**
 * Apply a quality gate:
 * 1. Discard leads below minScore.
 * 2. Per source, keep at most maxPerSource highest-scoring leads.
 */
function applyQualityGate(
  leads: ScoredLead[],
  minScore: number,
  maxPerSource: number,
): ScoredLead[] {
  const qualified = leads.filter(l => l.score >= minScore);

  const bySource = new Map<string, ScoredLead[]>();
  for (const lead of qualified) {
    const bucket = bySource.get(lead.source) ?? [];
    bucket.push(lead);
    bySource.set(lead.source, bucket);
  }

  const result: ScoredLead[] = [];
  for (const bucket of bySource.values()) {
    bucket.sort((a, b) => b.score - a.score);
    result.push(...bucket.slice(0, maxPerSource));
  }
  return result;
}

export async function runScan(): Promise<ScoredLead[]> {
  console.log('[scanner] Starting scan…');
  const scanId = startScan();

  // Quality gate thresholds — configurable via .env
  // Use || fallback so non-numeric / missing env values don't produce NaN
  const minScore     = Number(process.env.MIN_LEAD_SCORE)      || 5;
  const maxPerSource = Number(process.env.MAX_LEADS_PER_SOURCE) || 15;

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

    const scored  = await scoreLeads(raw);
    const quality = applyQualityGate(scored, minScore, maxPerSource);

    console.log(`[scanner] Quality gate (score≥${minScore}, max ${maxPerSource}/source): ${scored.length} → ${quality.length} leads`);

    for (const lead of quality) {
      upsertLead(lead);
    }

    finishScan(scanId, quality.length);
    console.log(`[scanner] Scan complete. Persisted ${quality.length} leads.`);
    scanBus.emit('scan', { type: 'done', total: quality.length });

    return quality;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    scanBus.emit('scan', { type: 'error', message });
    throw err;
  }
}
