// Canonical content normalization — shared by the browser (lib/zk.js) and the
// server (server/utils/chain.ts) so the author-side and verifier-side hash of the
// same content agree despite platform reformatting (design spec §5.2).
//
// Rule set, applied in this order (deterministic — no locale, no randomness):
//   1. strip HTML comments and tags (platform chrome)
//   2. reduce markdown images and links to their alt / link text
//   3. drop ATX heading and blockquote markers
//   4. unify line endings to LF
//   5. Unicode NFC (so decomposed text hashes like its composed form)
//   6. collapse every whitespace run to one space, then trim
//
// Changing this rule set changes every content hash; treat it as an interface.
export function normalizeContent(text) {
  if (text === null || text === undefined) return "";
  let s = String(text);
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  s = s.replace(/\r\n?/g, "\n");
  s = s.normalize("NFC");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
