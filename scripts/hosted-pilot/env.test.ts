import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs module (the pilot runs with node directly)
import { PilotTargetError, describeEnv, jwtRef, parseEnvFile, resolvePilotTarget } from "./env.mjs";

// Q4.7 hosted pilot: the guard that makes a wrong target unreachable (docs/q4-7-hosted-pilot-plan.md, section 3)
const PILOT = "pilotpilotpilotpilot";
const PROD = "prodprodprodprodprod";
const jwt = (ref: string) => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url")}.sig`;
const good = () => ({
  AYRA_PILOT_PROJECT_REF: PILOT,
  AYRA_PRODUCTION_PROJECT_REF: PROD,
  AYRA_PILOT_SUPABASE_URL: `https://${PILOT}.supabase.co`,
  AYRA_PILOT_ANON_KEY: jwt(PILOT),
  AYRA_PILOT_SERVICE_ROLE_KEY: jwt(PILOT),
  AYRA_PILOT_DB_URL: `postgresql://postgres.${PILOT}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  AYRA_PILOT_DB_CA_FILE: "package.json", // any existing file stands for the certificate here
});
const fails = (env: Record<string, string>, argv: string[], rule: RegExp) => {
  expect(() => resolvePilotTarget(env, argv)).toThrow(PilotTargetError);
  expect(() => resolvePilotTarget(env, argv)).toThrow(rule);
};

describe("hosted pilot target guard", () => {
  it("the pilot with --target is resolved; --confirm is a separate, explicit yes", () => {
    const t = resolvePilotTarget(good(), ["preflight", "--target", PILOT]);
    expect(t.ref).toBe(PILOT);
    expect(t.confirmed).toBe(false);
    expect(resolvePilotTarget(good(), ["seed", "--target", PILOT, "--confirm", PILOT]).confirmed).toBe(true);
    expect(resolvePilotTarget(good(), ["seed", "--target", PILOT, "--confirm", PROD]).confirmed).toBe(false);
  });

  it("the direct database address of the pilot is accepted too", () => {
    expect(resolvePilotTarget({ ...good(), AYRA_PILOT_DB_URL: `postgresql://postgres:pw@db.${PILOT}.supabase.co:5432/postgres` }, ["x", "--target", PILOT]).ref).toBe(PILOT);
  });

  it("no --target, or another one: refused", () => {
    fails(good(), ["preflight"], /--target/);
    fails(good(), ["preflight", "--target", PROD], /--target/);
  });

  it("the Production ref anywhere: refused", () => {
    fails({ ...good(), AYRA_PRODUCTION_PROJECT_REF: PILOT }, ["x", "--target", PILOT], /Production project/);
    fails({ ...good(), AYRA_PILOT_DB_URL: `postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres` }, ["x", "--target", PILOT], /DB_URL/);
    fails({ ...good(), AYRA_PILOT_SERVICE_ROLE_KEY: jwt(PROD) }, ["x", "--target", PILOT], /Production ref|another project/);
  });

  it("an address or key of another project: refused", () => {
    fails({ ...good(), AYRA_PILOT_SUPABASE_URL: "https://otherotherotherother.supabase.co" }, ["x", "--target", PILOT], /SUPABASE_URL/);
    fails({ ...good(), AYRA_PILOT_DB_URL: "postgresql://postgres.otherotherotherother:pw@aws-0-x.pooler.supabase.com:5432/postgres" }, ["x", "--target", PILOT], /DB_URL/);
    fails({ ...good(), AYRA_PILOT_DB_URL: "postgresql://postgres:pw@localhost:5432/postgres" }, ["x", "--target", PILOT], /DB_URL/);
    fails({ ...good(), AYRA_PILOT_DB_URL: good().AYRA_PILOT_DB_URL.replace(":5432/", ":6543/") }, ["x", "--target", PILOT], /transaction pooler/);
    fails({ ...good(), AYRA_PILOT_ANON_KEY: jwt("otherotherotherother") }, ["x", "--target", PILOT], /another project/);
  });

  it("missing or malformed settings: refused, naming the setting and never a value", () => {
    const env = good() as Record<string, string>;
    delete env.AYRA_PILOT_SERVICE_ROLE_KEY;
    fails(env, ["x", "--target", PILOT], /AYRA_PILOT_SERVICE_ROLE_KEY is missing/);
    fails({ ...good(), AYRA_PILOT_PROJECT_REF: "PILOT" }, ["x", "--target", "PILOT"], /not a project ref/);
    try {
      resolvePilotTarget({ ...good(), AYRA_PILOT_SERVICE_ROLE_KEY: jwt(PROD) }, ["x", "--target", PILOT]);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("eyJ");
      expect(String((e as Error).message)).not.toContain(PROD);
    }
    expect(Object.values(describeEnv(good()))).toEqual(Array(7).fill("set"));
    fails({ ...good(), AYRA_PILOT_DB_CA_FILE: "no-such-certificate.crt" }, ["x", "--target", PILOT], /CA_FILE does not exist/);
  });

  it("the env file and key helpers", () => {
    expect(parseEnvFile('# c\nA=1\nB="two"\n\nC = \'3\'\nbad\n')).toEqual({ A: "1", B: "two", C: "3" });
    expect(jwtRef(jwt(PILOT))).toBe(PILOT);
    expect(jwtRef("sb_secret_abc")).toBeNull();
  });
});
