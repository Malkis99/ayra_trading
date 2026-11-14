/**
 * Prints the QH-6 economy comparison (lib/econ-sim-qh6.ts): today's rules vs the proposed verifiable missions
 * (variant A = 40 XP + 10 Coins per mission; B = 30 XP + 5 Coins; C = 40 XP, Coins only for trading missions).
 *
 * Run: npx vite-node scripts/econ-sim-qh6.ts [days]
 */
import { PLAYERS, missionSplit, simulateCurrent, simulateProposed, variantOf } from "../lib/econ-sim-qh6";

const days = Number(process.argv[2]) || 90;
const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`QH-6 economy: ${days} days\n`);
console.log("player     rules    total XP  XP/day   self XP  share   coins  coins/day  level  missions  trade-log  max coins/day  max missions/day");
for (const p of PLAYERS) {
  const cur = simulateCurrent(p, days);
  const a = simulateProposed(p, days);
  const split = missionSplit(p, days);
  for (const r of [cur, a, variantOf(a, split.trading, split.other, "B"), variantOf(a, split.trading, split.other, "C")]) {
    console.log(
      `${p.padEnd(10)} ${r.rules.padEnd(7)} ${pad(r.totalXp, 9)} ${pad((r.totalXp / days).toFixed(0), 7)} ${pad(r.selfXp, 9)} ${pad(((r.selfXp / Math.max(1, r.totalXp)) * 100).toFixed(0) + "%", 6)} ${pad(r.coins, 7)} ${pad((r.coins / days).toFixed(1), 10)} ${pad(r.level, 6)} ${pad(r.missions, 9)} ${pad(r.tradeLog, 10)} ${pad(r.maxCoinsDay, 14)} ${pad(r.maxMissionsDay, 17)}`
    );
  }
}
