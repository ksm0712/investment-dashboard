import type { ResearchRecord, ResearchRun } from "./ai-research-types.ts";
import { execute, hasPersistentDatabase, initDb } from "./db.ts";

type MemoryRecord = ResearchRecord & { inputHash: string | null };
const memoryRecords = new Map<string, MemoryRecord>();
const memoryRequests = new Map<string, number[]>();

function recordKey(userId: string, securityId: number) {
  return `${userId}:${securityId}`;
}

function safeParseRun(value: unknown): ResearchRun | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as ResearchRun;
  } catch {
    return null;
  }
}

export async function getResearchRecord(userId: string, securityId: number): Promise<ResearchRecord> {
  await initDb();
  if (!hasPersistentDatabase()) {
    const record = memoryRecords.get(recordKey(userId, securityId));
    return { thesis: record?.thesis || "", analysis: record?.analysis || null };
  }
  const { rows } = await execute(
    `SELECT r.thesis, r.analysis_json
     FROM investment_research r
     JOIN securities s ON s.id=r.security_id
     JOIN portfolios p ON p.id=s.portfolio_id
     WHERE r.security_id=? AND p.user_id=?`,
    [securityId, userId],
  );
  const row = rows[0];
  return { thesis: String(row?.thesis || ""), analysis: safeParseRun(row?.analysis_json) };
}

export async function saveResearchThesis(userId: string, securityId: number, thesis: string) {
  await initDb();
  const clean = thesis.trim().slice(0, 2_000);
  if (!hasPersistentDatabase()) {
    const key = recordKey(userId, securityId);
    const current = memoryRecords.get(key);
    memoryRecords.set(key, {
      thesis: clean,
      analysis: current?.thesis === clean ? current.analysis : null,
      inputHash: current?.thesis === clean ? current.inputHash : null,
    });
    return;
  }
  const { rows } = await execute(
    `SELECT r.thesis FROM investment_research r
     JOIN securities s ON s.id=r.security_id JOIN portfolios p ON p.id=s.portfolio_id
     WHERE r.security_id=? AND p.user_id=?`,
    [securityId, userId],
  );
  const changed = String(rows[0]?.thesis || "") !== clean;
  await execute(
    `INSERT INTO investment_research (security_id,thesis,analysis_json,input_hash,provider,model,updated_at)
     SELECT s.id,?,NULL,NULL,NULL,NULL,? FROM securities s
     JOIN portfolios p ON p.id=s.portfolio_id WHERE s.id=? AND p.user_id=?
     ON CONFLICT(security_id) DO UPDATE SET
       thesis=excluded.thesis,
       analysis_json=CASE WHEN ? THEN NULL ELSE investment_research.analysis_json END,
       input_hash=CASE WHEN ? THEN NULL ELSE investment_research.input_hash END,
       updated_at=excluded.updated_at`,
    [clean, new Date().toISOString(), securityId, userId, changed, changed],
  );
}

export async function getCachedResearchRun(userId: string, securityId: number, inputHash: string) {
  await initDb();
  if (!hasPersistentDatabase()) {
    const record = memoryRecords.get(recordKey(userId, securityId));
    return record?.inputHash === inputHash && record.analysis ? { ...record.analysis, cached: true } : null;
  }
  const { rows } = await execute(
    `SELECT r.analysis_json FROM investment_research r
     JOIN securities s ON s.id=r.security_id JOIN portfolios p ON p.id=s.portfolio_id
     WHERE r.security_id=? AND r.input_hash=? AND p.user_id=?`,
    [securityId, inputHash, userId],
  );
  const run = safeParseRun(rows[0]?.analysis_json);
  return run ? { ...run, cached: true } : null;
}

export async function saveResearchRun(userId: string, securityId: number, inputHash: string, run: ResearchRun) {
  await initDb();
  if (!hasPersistentDatabase()) {
    const key = recordKey(userId, securityId);
    const current = memoryRecords.get(key);
    memoryRecords.set(key, { thesis: run.thesis || current?.thesis || "", analysis: run, inputHash });
    return;
  }
  await execute(
    `INSERT INTO investment_research (security_id,thesis,analysis_json,input_hash,provider,model,updated_at)
     SELECT s.id,?,?,?,?,?,? FROM securities s
     JOIN portfolios p ON p.id=s.portfolio_id WHERE s.id=? AND p.user_id=?
     ON CONFLICT(security_id) DO UPDATE SET
       thesis=excluded.thesis, analysis_json=excluded.analysis_json, input_hash=excluded.input_hash,
       provider=excluded.provider, model=excluded.model, updated_at=excluded.updated_at`,
    [run.thesis, JSON.stringify(run), inputHash, run.provider, run.model, new Date().toISOString(), securityId, userId],
  );
}

export class AiRateLimitError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`Daily AI research limit reached (${limit} requests). Cached analyses remain available.`);
    this.name = "AiRateLimitError";
    this.limit = limit;
  }
}

export async function consumeAiRequest(userId: string, securityId: number, now = Date.now()) {
  await initDb();
  const limit = Math.max(1, Number(process.env.AI_DAILY_REQUEST_LIMIT || 10));
  const cutoff = new Date(now - 24 * 60 * 60 * 1_000).toISOString();
  if (!hasPersistentDatabase()) {
    const recent = (memoryRequests.get(userId) || []).filter((timestamp) => timestamp > now - 24 * 60 * 60 * 1_000);
    if (recent.length >= limit) throw new AiRateLimitError(limit);
    recent.push(now);
    memoryRequests.set(userId, recent);
    return { used: recent.length, limit };
  }
  const { rows } = await execute("SELECT COUNT(*) AS count FROM ai_request_log WHERE user_id=? AND requested_at>=?", [userId, cutoff]);
  const count = Number(rows[0]?.count || 0);
  if (count >= limit) throw new AiRateLimitError(limit);
  await execute("INSERT INTO ai_request_log (user_id,security_id,requested_at) VALUES (?,?,?)", [userId, securityId, new Date(now).toISOString()]);
  return { used: count + 1, limit };
}
