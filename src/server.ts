import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import cron from 'node-cron';
import { z } from 'zod';
import { getLeads, getLead, saveReply, getStats } from './db';
import { runScan } from './scheduler';

const app  = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// ── API ────────────────────────────────────────────────────────────────────────

const LeadFilterSchema = z.object({
  source:        z.string().optional(),
  urgency:       z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  minScore:      z.coerce.number().min(1).max(10).optional(),
  page:          z.coerce.number().min(1).optional(),
  pageSize:      z.coerce.number().min(1).max(100).optional(),
  unrepliedOnly: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
});

/** GET /api/leads — paginated feed with filters */
app.get('/api/leads', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = LeadFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const result = getLeads(parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/leads/:id — single lead */
app.get('/api/leads/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const lead = getLead(req.params.id);
    if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

/** POST /api/scan — trigger a scan manually */
app.post('/api/scan', (_req: Request, res: Response) => {
  // Return immediately; scan runs in background
  res.json({ message: 'Scan started' });
  runScan().catch(err => console.error('[server] Background scan error:', err));
});

const ReplySchema = z.object({ reply: z.string().min(1) });

/** POST /api/leads/:id/reply — save a drafted reply */
app.post('/api/leads/:id/reply', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ReplySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const lead = getLead(req.params.id);
    if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
    saveReply(req.params.id, parsed.data.reply);
    res.json({ message: 'Reply saved' });
  } catch (err) {
    next(err);
  }
});

/** GET /api/stats — trend data for dashboard */
app.get('/api/stats', (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(getStats());
  } catch (err) {
    next(err);
  }
});

// ── Error handler ──────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Scheduler ─────────────────────────────────────────────────────────────────

const schedule = process.env.CRON_SCHEDULE ?? '0 8 * * *';
cron.schedule(schedule, () => {
  console.log(`[cron] Triggering scheduled scan (${schedule})`);
  runScan().catch(err => console.error('[cron] Scan error:', err));
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Signal Scanner listening on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
});
