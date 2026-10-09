// Demo personhood-registry identity secrets.
//
// These sixteen values belong to the demo registry members but are deliberately
// NOT part of the publicly-served /zk/registry.json, which now exposes only the
// member commitments and Merkle paths. They are test credentials for the testnet
// walkthrough only: in production the identity secret is generated on the user's
// device and never leaves it (see docs/superpowers/specs).
const DEMO_IDENTITY_SECRETS = {
  0: "7001",
  1: "7002",
  2: "7003",
  3: "7004",
  4: "7005",
  5: "7006",
  6: "7007",
  7: "7008",
  8: "7009",
  9: "7010",
  10: "7011",
  11: "7012",
  12: "7013",
  13: "7014",
  14: "7015",
  15: "7016",
};

export function demoIdentitySecret(memberId) {
  const secret = DEMO_IDENTITY_SECRETS[memberId];
  if (!secret) throw new Error(`no demo identity secret for member ${memberId}`);
  return secret;
}
