import type { EventRow } from "./types";
import { scheduleIdentity } from "./identity";
import { plainText } from "./xml";
import { htmlTables, blsPeriod } from "./html-table";
import { PPI_METRICS, PPI_SCHEDULE_URL } from "./ppi";
import { JOLTS_CODE, JOLTS_TITLE, JOLTS_SCHEDULE_URL } from "./jolts";
import { NEW_YORK, wallToUtc } from "./time";

/** Only explicitly published reference months/days; never extrapolate a cadence. */
function blsSchedule(html: string, label: string, title: string, url: string, metrics: Record<string,{title:string}>): EventRow[] {
  if (!plainText(html).toLowerCase().includes(("Schedule of Releases for the " + title).toLowerCase())) throw new Error(`BLS ${label} schedule: official title missing`);
  const tables = htmlTables(html).filter(t => t.rows.some(r => r.join(" ").match(/Reference Month Release Date Release Time/i)));
  if (tables.length !== 1) throw new Error(`BLS ${label} schedule: reference-month table missing or ambiguous`);
  // A whole-page published version is usable only when explicitly supplied by the source.
  const modified = plainText(html).match(/Last Modified Date:\s*(\w+) (\d{1,2}), (\d{4})/i);
  const modifiedMonth = modified && blsPeriod(modified[1],modified[3]);
  const version = modifiedMonth && modified ? `${modifiedMonth}-${modified[2].padStart(2,"0")}T00:00:00.000Z` : null;
  const rows: EventRow[] = [];
  const seen = new Set<string>();
  for (const row of tables[0].rows) {
    if (row.length !== 3) continue;
    const ref = /^(\w+) (\d{4})$/.exec(row[0]);
    const date = /^(\w+)\.? (\d{1,2}), (\d{4})$/.exec(row[1]);
    const time = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(row[2]);
    if (!ref || !date || !time) continue;
    const period = blsPeriod(ref[1],ref[2]), month = blsPeriod(date[1],date[3]);
    if (!period || !month) throw new Error(`BLS ${label} schedule: invalid explicit month`);
    const day = `${month}-${date[2].padStart(2,"0")}`;
    if (new Date(`${day}T00:00Z`).toISOString().slice(0,10) !== day || +time[1] < 1 || +time[1] > 12 || +time[2] > 59) throw new Error(`BLS ${label} schedule: invalid date/time`);
    if (seen.has(period)) throw new Error(`BLS ${label} schedule: duplicate/ambiguous reference period`);
    seen.add(period);
    const hour = +time[1] % 12 + (time[3] === "PM" ? 12 : 0);
    const starts = new Date(wallToUtc(day,`${String(hour).padStart(2,"0")}:${time[2]}`,NEW_YORK)).toISOString();
    for (const [code,m] of Object.entries(metrics)) rows.push(scheduleIdentity({id:`bls:${code}:${day}`,source:"bls",country:"us",kind:"release",code,title:m.title,importance:2,starts_at:starts,time_tbd:false,url},period,"regular",null,version ? {modified:version} : {}));
  }
  if (!rows.length) throw new Error(`BLS ${label} schedule: no verified official dates`);
  return rows;
}

export const ppiSchedule = (html:string) => blsSchedule(html,"PPI","Producer Price Index",PPI_SCHEDULE_URL,PPI_METRICS);
export const joltsSchedule = (html:string) => blsSchedule(html,"JOLTS",JOLTS_TITLE,JOLTS_SCHEDULE_URL,{[JOLTS_CODE]:{title:JOLTS_TITLE}});
