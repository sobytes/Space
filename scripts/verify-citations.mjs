/**
 * Re-resolve every DOI the habitability citations claim, and check it says what we say.
 *
 * Online, so it is not part of `./build.sh check`: a gate that fails when the network is
 * down teaches people to ignore gates. The offline half lives in
 * `website/src/citations.test.ts`, which requires every citation to be registered either
 * with a DOI or with a stated reason there is none; this is what makes the DOIs mean
 * something.
 *
 * It is worth running. The first pass found Juno's magnetic field model cited as
 * Connerney et al. 2018, Nature 356, and volume 356 of Nature is from 1992.
 *
 *   node scripts/verify-citations.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const registry = JSON.parse(
  readFileSync(join(ROOT, "contracts/habitability/citations.json"), "utf8"),
);

/**
 * Pull the metadata Crossref holds, not the page a publisher renders.
 *
 * Content negotiation on doi.org returns CSL JSON for any registered DOI regardless of who
 * published it, so one code path covers Nature, Science, Elsevier and the AAS. Scraping the
 * landing pages would need one parser each and would break on redesigns.
 */
async function resolve(doi) {
  const response = await fetch(`https://doi.org/${doi}`, {
    headers: { Accept: "application/vnd.citationstyles.csl+json" },
    redirect: "follow",
  });
  if (!response.ok) return null;
  return response.json();
}

function surnameOf(record) {
  return record?.author?.[0]?.family ?? "";
}

function yearOf(record) {
  return record?.issued?.["date-parts"]?.[0]?.[0] ?? null;
}

/**
 * Undo a double encoding, for the records that arrive with one.
 *
 * Crossref serves this one mis-encoded: the payload for Schröder 2008 declares UTF-8 and
 * contains the UTF-8 bytes of "Schröder" encoded as UTF-8 a second time, so decoding it
 * correctly still yields "SchrÃ¶der". Reading the characters back as Latin-1 and decoding
 * once more recovers the name.
 *
 * Applied as an alternative rather than in place, because the same operation destroys a
 * correctly encoded name: "Schröder" through it comes out with a replacement character. So
 * the comparison accepts either form and nothing is rewritten.
 */
function undoDoubleEncoding(value) {
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}

/** Accent-insensitive, because the registry keys are typed in ASCII and Acuña is not. */
function sameSurname(a, b) {
  const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return fold(a) === fold(b) || fold(undoDoubleEncoding(a)) === fold(b);
}


const entries = Object.entries(registry.verified);
console.log(`checking ${entries.length} DOIs against Crossref\n`);

let wrong = 0;
let unreachable = 0;

for (const [key, doi] of entries) {
  const [surname, year] = [key.slice(0, key.lastIndexOf(" ")), key.slice(key.lastIndexOf(" ") + 1)];
  let record;
  try {
    record = await resolve(doi);
  } catch {
    record = null;
  }

  if (!record) {
    unreachable += 1;
    console.log(`  ${key.padEnd(20)} UNREACHABLE  ${doi}`);
    continue;
  }

  const problems = [];
  if (!sameSurname(surnameOf(record), surname)) {
    problems.push(`first author is ${surnameOf(record)}, not ${surname}`);
  }
  if (String(yearOf(record)) !== year) {
    problems.push(`year is ${yearOf(record)}, not ${year}`);
  }

  if (problems.length > 0) {
    wrong += 1;
    console.log(`  ${key.padEnd(20)} WRONG  ${problems.join("; ")}`);
  } else {
    const where = `${record["container-title"] ?? "?"} ${record.volume ?? "?"}`;
    console.log(`  ${key.padEnd(20)} ok     ${where}`);
  }
}

console.log();
if (unreachable > 0) {
  console.log(`${unreachable} could not be reached; that is a network result, not a citation result`);
}
if (wrong > 0) {
  console.log(`${wrong} citations disagree with Crossref`);
  process.exit(1);
}
console.log(`all ${entries.length - unreachable} reachable citations check out`);
