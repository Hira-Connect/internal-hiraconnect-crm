import { strict as assert } from "node:assert";
import { test } from "node:test";
import { inspectServiceKey, jwtClaims, projectRef, serviceKeyMessage } from "./service-key";

const URL_ = "https://tcojgrxtpldiieytvthl.supabase.co";

/** Builds an unsigned JWT with the given payload — enough for a decoder that
 *  reads claims rather than verifying them. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

const SERVICE = jwt({ role: "service_role", ref: "tcojgrxtpldiieytvthl" });
const ANON = jwt({ role: "anon", ref: "tcojgrxtpldiieytvthl" });

test("a real service-role key passes", () => {
  const status = inspectServiceKey({ serviceKey: SERVICE, anonKey: ANON, supabaseUrl: URL_ });
  assert.deepEqual(status, { status: "ok", kind: "jwt" });
  assert.equal(serviceKeyMessage(status), null);
});

test("an unset key is missing, not invalid", () => {
  for (const serviceKey of [undefined, "", "   "]) {
    assert.equal(inspectServiceKey({ serviceKey, anonKey: ANON, supabaseUrl: URL_ }).status, "missing");
  }
});

test("the anon key pasted into the service slot is named exactly", () => {
  // The mistake that produced GoTrue's "User not allowed" 403 in production.
  const status = inspectServiceKey({ serviceKey: ANON, anonKey: ANON, supabaseUrl: URL_ });
  assert.equal(status.status, "invalid");
  assert.match(serviceKeyMessage(status)!, /anon key/);
});

test("an anon-role key is caught even when it is not this project's anon key", () => {
  const otherAnon = jwt({ role: "anon", ref: "tcojgrxtpldiieytvthl", iat: 1 });
  const status = inspectServiceKey({ serviceKey: otherAnon, anonKey: ANON, supabaseUrl: URL_ });
  assert.equal(status.status, "invalid");
  assert.match(serviceKeyMessage(status)!, /role is "anon"/);
});

test("a key from another project is caught", () => {
  const status = inspectServiceKey({
    serviceKey: jwt({ role: "service_role", ref: "someotherproject" }),
    anonKey: ANON,
    supabaseUrl: URL_,
  });
  assert.equal(status.status, "invalid");
  assert.match(serviceKeyMessage(status)!, /someotherproject/);
});

test("the newer opaque key formats are told apart", () => {
  assert.deepEqual(
    inspectServiceKey({ serviceKey: "sb_secret_abc123", anonKey: ANON, supabaseUrl: URL_ }),
    { status: "ok", kind: "secret" },
  );
  const publishable = inspectServiceKey({
    serviceKey: "sb_publishable_abc123",
    anonKey: ANON,
    supabaseUrl: URL_,
  });
  assert.equal(publishable.status, "invalid");
  assert.match(serviceKeyMessage(publishable)!, /publishable/);
});

test("a truncated or quoted paste is caught rather than sent to Supabase", () => {
  const status = inspectServiceKey({ serviceKey: "eyJhbGciOi", anonKey: ANON, supabaseUrl: URL_ });
  assert.equal(status.status, "invalid");
  assert.match(serviceKeyMessage(status)!, /neither a JWT/);
});

test("surrounding whitespace does not fail a good key", () => {
  assert.equal(
    inspectServiceKey({ serviceKey: `\n  ${SERVICE}  `, anonKey: ANON, supabaseUrl: URL_ }).status,
    "ok",
  );
});

test("a mismatched ref is ignored when the URL is unusable", () => {
  // Better to let the call through and report Supabase's own error than to
  // block on a check we cannot make.
  assert.equal(
    inspectServiceKey({ serviceKey: SERVICE, anonKey: ANON, supabaseUrl: "not-a-url" }).status,
    "ok",
  );
});

test("claim and ref helpers", () => {
  assert.equal(jwtClaims("not.a.jwt"), null);
  assert.equal(jwtClaims("onlyonesegment"), null);
  assert.equal((jwtClaims(SERVICE) as { role: string }).role, "service_role");
  assert.equal(projectRef(URL_), "tcojgrxtpldiieytvthl");
  assert.equal(projectRef("nonsense"), null);
  assert.equal(projectRef(undefined), null);
});
