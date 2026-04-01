import { RawLead } from '../types';

// Focused on communities where real end-users (not vendors) discuss their tools.
// Removed r/saas and r/consulting — both are heavily polluted with vendor/marketer content.
const SUBREDDITS = [
  'projectmanagement',
  'Entrepreneur',
  'smallbusiness',
  'startups',
];

// Intent- and frustration-based queries instead of brand-keyword searches.
// These match organic first-person complaints and switching signals.
const DEFAULT_QUERIES = [
  'switching from monday',
  'leaving asana',
  'frustrated with clickup',
  'project management tool problems',
  'monday.com too expensive',
  'project management nightmare',
  'replacing our project management',
  'hate our project management software',
];

// Patterns that reliably indicate AI-generated, promotional, or low-signal content.
const NOISE_PATTERNS = [
  /\bin this (post|thread|article|guide)\b/i,
  /\bcomprehensive (guide|overview|review|breakdown)\b/i,
  /\blet me (walk|take) you\b/i,
  /\b(firstly|secondly|thirdly)[,\s]/i,
  /\bin conclusion\b|\bto summarize\b/i,
  /\baffiliate\b|\bsponsored post\b|\bdisclosure\b/i,
];

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(text));
}

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
  // sort=top&t=month: high-engagement posts only — filters out zero-traction spam sorted by new
  const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=month&limit=25`;

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

    // Require a real post body, not just a title-only match
    const body = (d.selftext ?? '').trim();
    if (body.length < 100) continue;

    // Require at least minimal community engagement
    if (d.ups < 3) continue;

    // Skip AI-generated / promotional content
    if (isNoise(body)) continue;

    leads.push({
      url:       `https://www.reddit.com${d.permalink}`,
      source:    'reddit',
      author:    d.author,
      text:      body,
      title:     d.title,
      upvotes:   d.ups,
      createdAt: new Date(d.created_utc * 1000),
      query,
    });
  }

  // Return highest-engagement posts first
  leads.sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0));

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
