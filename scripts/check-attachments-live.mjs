// Manual check of the 0005 Storage rules on the LIVE Supabase project, signed in as yourself (the owner).
// Uses only the public project URL and anon key; your password is asked here and sent only to Supabase.
//   node scripts/check-attachments-live.mjs low     — after lowering the limit to 0: two uploads; the second must be refused
//     (the server does not know the size of the file being uploaded, only of files already saved, so in an empty
//     folder the first one passes: the limit can be exceeded by at most one file, up to 5 MB)
//   node scripts/check-attachments-live.mjs normal  — with the normal limit: allowed / refused as expected
// Leaves at most one ~1 KB test file per run `live_check_….webp` in your folder (a file without a row; the daily cleanup
// may remove it after 24 hours, or delete it in the dashboard: Storage → journal-attachments).
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const mode = process.argv[2];
if (mode !== "low" && mode !== "normal") {
  console.log("Usage: node scripts/check-attachments-live.mjs low|normal");
  process.exit(2);
}

// One reader for all questions; the password is not echoed
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
const write = rl._writeToOutput?.bind(rl);
rl._writeToOutput = (s) => { if (!muted && write) write(s); };
const lines = rl[Symbol.asyncIterator]();
async function ask(question, hidden = false) {
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  if (muted) process.stdout.write("\n");
  muted = false;
  return (value || "").trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || (await ask("Project URL (Settings → API): "));
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (await ask("anon public key (Settings → API): "));
const email = await ask("E-mail: ");
const password = await ask("Password: ", true);
rl.close();

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError || !auth.user) {
  console.log("Sign-in failed:", authError?.message);
  process.exit(1);
}
const uid = auth.user.id;
const bucket = supabase.storage.from("journal-attachments");
const small = new Uint8Array(1024).fill(7);
let failed = 0;

async function upload(name, body, contentType) {
  const { error } = await bucket.upload(name, new Blob([body], { type: contentType }), { contentType, upsert: false });
  return error ? `refused (${error.message})` : "allowed";
}
function expect(label, got, want) {
  const pass = got.startsWith(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FAIL"} ${label}: ${got}${pass ? "" : `  ← expected: ${want}`}`);
}

const testName = `${uid}/live_check_${Date.now()}.webp`;
if (mode === "low") {
  const { data: before } = await bucket.list(uid, { limit: 1000 });
  const saved = (before || []).reduce((sum, f) => sum + Number(f.metadata?.size || 0), 0);
  const first = await upload(testName, small, "image/webp");
  expect(`1st 1 KB upload with the limit at 0 (already saved: ${saved} bytes)`, first, saved > 0 ? "refused" : "allowed");
  expect("2nd 1 KB upload with the limit at 0", await upload(`${uid}/live_check_2_${Date.now()}.webp`, small, "image/webp"), "refused");
} else {
  expect("1 KB webp into your folder", await upload(testName, small, "image/webp"), "allowed");
  expect("gif into your folder", await upload(`${uid}/live_check_gif_${Date.now()}.webp`, small, "image/gif"), "refused");
  expect("webp into another user's folder", await upload(`${randomUUID()}/live_check_${Date.now()}.webp`, small, "image/webp"), "refused");
  expect("6 MB webp", await upload(`${uid}/live_check_big_${Date.now()}.webp`, new Uint8Array(6 * 1024 * 1024), "image/webp"), "refused");
  await bucket.remove([testName]);
  const { data: list } = await bucket.list(uid, { search: testName.split("/")[1] });
  expect("removing the fresh test file right away", list && list.length === 1 ? "refused (file kept)" : "allowed (file gone)", "refused");
}
await supabase.auth.signOut();
console.log(failed === 0 ? "\nAll as expected." : `\n${failed} check(s) not as expected — send this output to the developer.`);
process.exit(failed === 0 ? 0 : 1);
