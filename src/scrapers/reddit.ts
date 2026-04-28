import { RawLead } from '../types';
import { sanitizeText, isDeletedContent, isValidHttpUrl } from '../utils/dataQuality';

const SUBREDDITS = [
  'consulting',
  'projectmanagement',
  'saas',
  'Entrepreneur',
  'smallbusiness',
  'productivity',
];

const DEFAULT_QUERIES = [
  'Monday.com integration broken',
  'switching from Monday.com',
  'Asana too expensive',
  'ClickUp automation not working',
  'ClickUp frustrating',
  'Asana alternatives',
  'project management tool broken',
];

interface RedditChild {
  data: {
    id:          string;
    permalink:   string;
    author:      string;
    selftext?:   string;
    title:       string;
    ups:         number;
    created_utc: number;
  };
}

interface RedditResponse {
  data: { children: RedditChild[] };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchSubreddit(sub: string, query: string, delayMs: number): Promise<RawLead[]> {
  const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&limit=25`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'signal-scanner/1.0 (research tool)' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    console.warn(`[reddit] r/${sub} "${query}" → HTTP ${res.status}`);
    return [];
  }

  const json = (await res.json()) as RedditResponse;
  const leads: RawLead[] = [];

  for (const child of json.data.children) {
    const d = child.data;

    // Skip when the author account is deleted, or when the only available
    // text is a deletion/removal placeholder.  Line 1 catches author-only
    // deletion; line 2 catches rawText = '[deleted]' when e.g. selftext is
    // empty and the title itself was removed.
    if (isDeletedContent(d.author) || (isDeletedContent(d.selftext ?? '') && isDeletedContent(d.title))) continue;

    const rawText = (d.selftext ?? '').trim() || d.title;
    if (isDeletedContent(rawText)) continue;

    const text  = sanitizeText(rawText);
    const title = sanitizeText(d.title);
    if (text.length < 20) continue;

    const leadUrl = `https://www.reddit.com${d.permalink}`;
    if (!isValidHttpUrl(leadUrl)) continue;

    leads.push({
      url:       leadUrl,
      source:    'reddit',
      author:    sanitizeText(d.author),
      text,
      title,
      upvotes:   d.ups,
      createdAt: new Date(d.created_utc * 1000),
      query,
    });
  }

  await sleep(delayMs);
  return leads;
}

export async function scrape(queries: string[] = DEFAULT_QUERIES): Promise<RawLead[]> {
  const delayMs = Number(process.env.REDDIT_DELAY_MS ?? 1500);
  const leads: RawLead[] = [];

  for (const sub of SUBREDDITS) {
    for (const q of queries) {
      try {
        const batch = await fetchSubreddit(sub, q, delayMs);
        leads.push(...batch);
        console.log(`[reddit] r/${sub} "${q}" → ${batch.length} leads`);
      } catch (err) {
        console.error(`[reddit] r/${sub} "${q}" error:`, err);
      }
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return leads.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
}
