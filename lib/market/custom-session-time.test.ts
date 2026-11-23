import { expect, it } from "vitest";
import { civilInstant, customSessionWindow, customSessionCycles } from "./custom-session-time";
it.each([
  ["Europe/London","2026-03-29","01:30"], ["America/New_York","2026-03-08","02:30"],
  ["Australia/Lord_Howe","2026-10-04","02:15"], ["Pacific/Apia","2011-12-30","12:00"],
])("rejects a nonexistent civil time in %s",(zone,day,time)=>expect(civilInstant(day,time,zone)).toBeNull());
it.each([
  ["Europe/London","2026-10-25","01:30","2026-10-25T00:30Z"],
  ["America/New_York","2026-11-01","01:30","2026-11-01T05:30Z"],
  ["Australia/Lord_Howe","2026-04-05","01:45","2026-04-04T14:45Z"],
  ["Asia/Kathmandu","2026-01-01","09:00","2026-01-01T03:15Z"],
])("uses the first exact instant, including non-hour offsets in %s",(zone,day,time,instant)=>expect(civilInstant(day,time,zone)).toBe(Date.parse(instant)));
it("overnight uses the next local date across both DST changes, not 24h UTC",()=>{
  const session={start:"23:00",end:"02:00",zone:"Europe/London"};
  const spring=customSessionWindow(session,"2026-03-28")!,fall=customSessionWindow(session,"2026-10-24")!;
  expect(spring.end-spring.start).toBe(2*3600000);expect(fall.end-fall.start).toBe(4*3600000);
  expect(customSessionWindow({...session,end:"01:30"},"2026-03-28")).toBeNull();
});
it("EU/US mismatch weeks and local dates are resolved by each IANA zone",()=>{
  expect(civilInstant("2026-03-20","08:00","Europe/London")).toBe(Date.parse("2026-03-20T08:00Z"));
  expect(civilInstant("2026-03-20","08:00","America/New_York")).toBe(Date.parse("2026-03-20T12:00Z"));
  expect(civilInstant("2026-03-30","08:00","Europe/London")).toBe(Date.parse("2026-03-30T07:00Z"));
  expect(customSessionCycles(Date.parse("2026-01-01T10:30Z"),"Pacific/Kiritimati")).toEqual(["2026-01-01","2026-01-02","2026-01-03"]);
});
