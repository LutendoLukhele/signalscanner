import crypto from 'crypto';
import { RawLead, ScoredLead, PainCategory, Urgency } from './types';

// ── Keyword maps ───────────────────────────────────────────────────────────────

const PAIN_KEYWORDS: Record<PainCategory, string[]> = {
  integration_failure: [
    'integration broken', 'integration not working', 'api broken', 'sync broken',
    'webhook fail', 'connect failed', 'oauth error', 'zapier broke',
  ],
  automation_broken: [
    'automation not working', 'automation broken', 'workflow broken', 'auto-assign',
    'rule not firing', 'trigger not', 'action not', 'recipe broke',
  ],
  switching_intent: [
    'switching from', 'switch to', 'migrating to', 'moving to', 'looking for alternative',
    'alternative to', 'better than', 'replacing', 'cancel subscription', 'cancelling',
  ],
  pricing: [
    'too expensive', 'price increase', 'raised prices', 'pricing changed', 'overpriced',
    'not worth the price', 'cost too much', 'can\'t afford', 'billing issue',
  ],
  complexity: [
    'too complicated', 'too complex', 'confusing', 'hard to use', 'steep learning curve',
    'not intuitive', 'overwhelming', 'bloated', 'hard to set up',
  ],
  support: [
    'support is terrible', 'no response from support', 'support doesn\'t help',
    'customer service', 'waiting for support', 'support ticket', 'ghost me',
  ],
  other: [],
};

const URGENCY_HIGH_PATTERNS = [
  'urgent', 'asap', 'immediately', 'right now', 'critical', 'broken', 'down', 'not working',
  'lost data', 'can\'t work', 'blocked', 'emergency', 'deadline',
];

const URGENCY_LOW_PATTERNS = [
  'thinking about', 'considering', 'maybe', 'one day', 'eventually', 'curious',
  'wondering if', 'might', 'someday',
];

// ── Rule-based scorer ──────────────────────────────────────────────────────────

function detectPainCategory(text: string): PainCategory {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(PAIN_KEYWORDS) as [PainCategory, string[]][]) {
    if (cat === 'other') continue;
    if (keywords.some(k => lower.includes(k))) return cat;
  }
  return 'other';
}

function detectUrgency(text: string, score: number): Urgency {
  const lower = text.toLowerCase();
  if (URGENCY_HIGH_PATTERNS.some(p => lower.includes(p))) return 'HIGH';
  if (URGENCY_LOW_PATTERNS.some(p => lower.includes(p))) return 'LOW';
  if (score >= 7) return 'HIGH';
  if (score >= 4) return 'MEDIUM';
  return 'LOW';
}

function ruleScore(lead: RawLead): number {
  const lower = (lead.text + ' ' + (lead.title ?? '')).toLowerCase();
  let score = 3; // baseline

  // Pain signal presence
  let matchedKeywords = 0;
  for (const keywords of Object.values(PAIN_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) matchedKeywords++;
  }
  score += Math.min(matchedKeywords * 2, 4);

  // Upvotes boost (reddit / twitter)
  if (lead.upvotes && lead.upvotes > 50)  score += 1;
  if (lead.upvotes && lead.upvotes > 200) score += 1;

  // Review sources carry more buying-decision weight
  if (lead.source === 'g2' || lead.source === 'capterra') score += 1;

  // Recency boost — within last 48 h
  const ageHours = (Date.now() - lead.createdAt.getTime()) / 36e5;
  if (ageHours < 48) score += 1;

  return Math.max(1, Math.min(10, score));
}

// ── Ollama optional scorer ─────────────────────────────────────────────────────

interface OllamaResponse {
  response: string;
}

async function ollamaScore(lead: RawLead, baseScore: number): Promise<{ score: number; draftReply: string }> {
  const url   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL ?? 'llama3.2';

  const prompt = `You are an outreach intelligence assistant.
Rate the following lead for outreach potential on a scale 1-10 (10 = extremely urgent buyer signal).
Then write a short, genuine, non-spammy reply under 100 words.

Source: ${lead.source}
Author: ${lead.author}
Title: ${lead.title ?? 'N/A'}
Text: ${lead.text.slice(0, 500)}

Respond in JSON exactly like: {"score": 8, "reply": "...your reply here..."}`;

  try {
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

    const data = (await res.json()) as OllamaResponse;
    const match = data.response.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Ollama response');
    const parsed = JSON.parse(match[0]) as { score: number; reply: string };
    return {
      score:      Math.max(1, Math.min(10, Number(parsed.score) || baseScore)),
      draftReply: parsed.reply ?? '',
    };
  } catch {
    // Fall back to rule-based score silently
    return { score: baseScore, draftReply: '' };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function scoreLeads(raw: RawLead[]): Promise<ScoredLead[]> {
  const useOllama = process.env.OLLAMA_ENABLED === 'true';
  const now       = new Date();

  const scored: ScoredLead[] = [];

  for (const lead of raw) {
    const baseScore   = ruleScore(lead);
    const painCategory = detectPainCategory(lead.text + ' ' + (lead.title ?? ''));

    let score      = baseScore;
    let draftReply: string | undefined;

    if (useOllama) {
      const result = await ollamaScore(lead, baseScore);
      score      = result.score;
      draftReply = result.draftReply || undefined;
    }

    const urgency = detectUrgency(lead.text, score);
    const id      = crypto.createHash('sha256').update(lead.url).digest('hex');

    scored.push({
      ...lead,
      id,
      score,
      urgency,
      painCategory,
      draftReply,
      scannedAt: now,
    });
  }

  return scored;
}
