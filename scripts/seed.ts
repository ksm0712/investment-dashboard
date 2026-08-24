import { execute, addInvestment } from "../lib/db.ts";

export const BENCH_USER = "bench-user";

export async function loadFixture(holdings: 20 | 50) {
  const file = holdings === 50 ? "./fixtures/test-portfolio-50.json" : "./fixtures/test-portfolio.json";
  const mod = await import(file, { with: { type: "json" } });
  return mod.default as Array<Record<string, unknown>>;
}

export async function resetBenchUser(userId: string) {
  await execute(
    `DELETE FROM action_history WHERE security_id IN (
       SELECT s.id FROM securities s JOIN portfolios p ON p.id=s.portfolio_id WHERE p.user_id=?
     )`,
    [userId],
  );
  await execute(
    `DELETE FROM investment_lots WHERE security_id IN (
       SELECT s.id FROM securities s JOIN portfolios p ON p.id=s.portfolio_id WHERE p.user_id=?
     )`,
    [userId],
  );
  await execute(`DELETE FROM securities WHERE portfolio_id IN (SELECT id FROM portfolios WHERE user_id=?)`, [userId]);
  await execute(`DELETE FROM portfolios WHERE user_id=?`, [userId]);
}

export async function seed(userId: string, holdings: Array<Record<string, unknown>>) {
  for (const holding of holdings) {
    await addInvestment(userId, holding as any);
  }
}

export async function seedBenchUser(holdings: 20 | 50 = 20) {
  const fixture = await loadFixture(holdings);
  await resetBenchUser(BENCH_USER);
  await seed(BENCH_USER, fixture);
  return fixture;
}
