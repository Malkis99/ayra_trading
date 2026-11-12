/**
 * Prints the economy simulation (lib/econ-sim.ts): 3 kinds of players × 90 days on the real game rules, plus what
 * possible daily caps on self-report XP would change. The caps are options for the owner only — nothing applies them.
 *
 * Run: npx vite-node scripts/econ-sim.ts [days]
 */
import { simulate, withSelfCap, type Profile } from "../lib/econ-sim";
import { GAME_CONFIG } from "../lib/game-config";

const days = Number(process.argv[2]) || 90;
const profiles: Profile[] = ["honest", "active", "farmer"];
const results = profiles.map((p) => simulate(p, days));

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`Economy simulation: ${days} days, current rules (GAME_CONFIG.DAILY_COIN_CAP = ${GAME_CONFIG.DAILY_COIN_CAP})\n`);
console.log("profile   total XP   XP/day   self-report XP  share   coins  coins/day  level  max self XP/day");
for (const r of results) {
  const maxSelf = Math.max(...r.log.map((d) => d.selfXp));
  console.log(
    `${r.profile.padEnd(8)} ${pad(r.totalXp, 9)} ${pad((r.totalXp / days).toFixed(0), 8)} ${pad(r.selfXp, 15)} ${pad(((r.selfXp / Math.max(1, r.totalXp)) * 100).toFixed(0) + "%", 6)} ${pad(r.coins, 7)} ${pad((r.coins / days).toFixed(1), 10)} ${pad(r.level, 6)} ${pad(maxSelf, 16)}`
  );
}

console.log("\nOptions for a daily cap on self-report XP (NOT applied — for the owner's decision):");
console.log("cap/day     honest XP   active XP   farmer XP   farmer − honest");
for (const cap of [null, 150, 120, 90, 60]) {
  const v = results.map((r) => withSelfCap(r, cap).totalXp);
  console.log(`${String(cap ?? "none").padEnd(9)} ${pad(v[0], 11)} ${pad(v[1], 11)} ${pad(v[2], 11)} ${pad(v[2] - v[0], 17)}`);
}
