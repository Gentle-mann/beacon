/** Shape-only test token: no signing key, valid signature, or provider access. */
export function fakeJwt(subject: string) {
  return [
    Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: subject })).toString("base64url"),
    "unit_test_signature",
  ].join(".");
}
