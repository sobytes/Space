/**
 * Fetches heliocentric state vectors from JPL Horizons and writes them as test fixtures.
 *
 * This runs at development time, never at runtime. JPL states at
 * https://ssd-api.jpl.nasa.gov/doc/ that you may not embed their APIs in a website, and
 * the endpoint sends no CORS header, so the browser never talks to Horizons. These
 * fixtures are the ground truth that `npm run verify:ephemeris` compares the engine against.
 *
 * Honours JPL's fair-use policy: one request at a time, a real User-Agent, and a pause
 * between calls.
 */

import { writeFile, mkdir } from "node:fs/promises";

const ENDPOINT = "https://ssd.jpl.nasa.gov/api/horizons.api";
const USER_AGENT = "solar-system-sim/0.1 (development fixture generation; contact via repo)";
const PAUSE_MS = 1200;

/**
 * Horizons codes 1 through 8 are planetary BARYCENTERS, which is what the Standish
 * table models. Code 399 would be Earth itself; 3 is the Earth-Moon barycentre.
 */
const TARGETS = [
  { id: "mercury", command: "1" },
  { id: "venus", command: "2" },
  { id: "embary", command: "3" },
  { id: "mars", command: "4" },
  { id: "jupiter", command: "5" },
  { id: "saturn", command: "6" },
  { id: "uranus", command: "7" },
  { id: "neptune", command: "8" },
];

/** Spread across the Standish table's stated 1800-2050 validity window, plus its edges. */
const EPOCHS = [
  "1800-01-01", "1850-07-01", "1900-01-01", "1950-07-01",
  "2000-01-01", "2025-01-01", "2040-07-01", "2050-01-01",
];

function buildUrl(command, startTime, stopTime) {
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'",
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: "'1 d'",
    VEC_TABLE: "'2'",
    // Standish's elements are referenced to the mean ecliptic and equinox of J2000,
    // so asking for ICRF here would compare two different frames and look like a bug.
    REF_PLANE: "'ECLIPTIC'",
    OUT_UNITS: "'KM-S'",
    CSV_FORMAT: "'YES'",
    TIME_TYPE: "'TDB'",
  });
  return `${ENDPOINT}?${params}`;
}

function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Horizons returns one text report inside the JSON envelope. Rows sit between markers. */
function parseVectors(report) {
  const start = report.indexOf("$$SOE");
  const end = report.indexOf("$$EOE");
  if (start === -1 || end === -1) {
    throw new Error(`no $$SOE/$$EOE markers in report:\n${report.slice(0, 400)}`);
  }
  const frame = /Reference frame\s*:\s*(.+)/.exec(report)?.[1]?.trim() ?? "UNKNOWN";
  const units = /Output units\s*:\s*(.+)/.exec(report)?.[1]?.trim() ?? "UNKNOWN";
  const rows = report
    .slice(start + 5, end)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const parsed = rows.map((row) => {
    const f = row.split(",").map((s) => s.trim());
    return {
      jdTdb: Number(f[0]),
      calendar: f[1],
      positionKm: [Number(f[2]), Number(f[3]), Number(f[4])],
      velocityKmS: [Number(f[5]), Number(f[6]), Number(f[7])],
    };
  });
  return { frame, units, rows: parsed };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(command, epoch, attempt = 1) {
  const url = buildUrl(command, epoch, nextDay(epoch));
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    if (attempt < 3) {
      // Back off rather than retry immediately, per JPL's fair-use policy.
      await pause(PAUSE_MS * 4 * attempt);
      return fetchOne(command, epoch, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} for command ${command} at ${epoch}`);
  }
  const body = await res.json();
  if (body.error) throw new Error(`Horizons error for ${command} at ${epoch}: ${body.error}`);
  return parseVectors(body.result);
}

async function main() {
  await mkdir("fixtures/horizons", { recursive: true });
  let requests = 0;
  const frames = new Set();
  const unitSet = new Set();

  for (const target of TARGETS) {
    const samples = [];
    for (const epoch of EPOCHS) {
      const { frame, units, rows } = await fetchOne(target.command, epoch);
      requests += 1;
      frames.add(frame);
      unitSet.add(units);
      samples.push({ epoch, ...rows[0] });
      process.stdout.write(`  ${target.id.padEnd(8)} ${epoch}  ${rows[0].positionKm[0].toExponential(6)}\n`);
      await pause(PAUSE_MS);
    }
    await writeFile(
      `fixtures/horizons/${target.id}.json`,
      JSON.stringify(
        {
          body: target.id,
          horizonsCommand: target.command,
          centre: "Sun (500@10)",
          source: "https://ssd.jpl.nasa.gov/api/horizons.api",
          fetchedAt: new Date().toISOString(),
          samples,
        },
        null,
        2,
      ) + "\n",
    );
  }

  console.log(`\n${requests} requests, ${TARGETS.length} fixture files written.`);
  console.log(`reference frame(s) returned: ${[...frames].join(" | ")}`);
  console.log(`output units returned:       ${[...unitSet].join(" | ")}`);
  if (frames.size !== 1) throw new Error("mixed reference frames in fixtures, refusing to continue");
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
