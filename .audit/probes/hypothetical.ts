import { advance, influenceOf, solarSystemAt, apsidalPrecession, type MassiveBody } from "../../src/engine/nbody";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { AU_IN_METRES, GM_SUN, SECONDS_PER_DAY } from "../../src/engine/units";

const YEAR = 365.25 * SECONDS_PER_DAY;
const limits = { tolerance: 1e-13, minStepSeconds: 60, maxStepSeconds: 5 * SECONDS_PER_DAY };

/** A body on a circular orbit at `au`, placed on the +x axis. */
function circular(id: string, gm: number, au: number): MassiveBody {
  const a = au * AU_IN_METRES;
  return {
    id, gm,
    position: { x: a, y: 0, z: 0 },
    velocity: { x: 0, y: Math.sqrt((GM_SUN + gm) / a), z: 0 },
  };
}

const GM_JUPITER = 126_712_764.1e9;
const GM_EARTH = 403_503.24e9;

console.log("=== a hypothetical planet added at 3 au: displacement it causes in 10 yr, km ===");
for (const [label, body] of [
  ["Jupiter-mass at 3 au", circular("intruder", GM_JUPITER, 3)],
  ["Earth-mass at 3 au", circular("intruder", GM_EARTH, 3)],
  ["Jupiter-mass at 1.5 au", circular("intruder", GM_JUPITER, 1.5)],
] as const) {
  const result = influenceOf(jdTdb(J2000_JD), "intruder", 10 * YEAR, [body], limits);
  const row: Record<string, string> = { added: label };
  for (const d of result) if (d.id !== "sun") row[d.id] = (d.metres / 1000).toFixed(0);
  console.log(JSON.stringify(row));
}

console.log("\n=== and what it does to Mercury's perihelion, arcsec/century ===");
const base = apsidalPrecession({ body: "mercury", epoch: jdTdb(J2000_JD), spanYears: 300, limits });
console.log("as it is                :", base.pericentreArcsecPerCentury.toFixed(2));
for (const au of [3, 1.5]) {
  const r = apsidalPrecession({
    body: "mercury", epoch: jdTdb(J2000_JD), spanYears: 300, limits,
    extra: [circular("intruder", GM_JUPITER, au)],
  });
  console.log(`with a Jupiter at ${au} au :`, r.pericentreArcsecPerCentury.toFixed(2),
              `(+${(r.pericentreArcsecPerCentury - base.pericentreArcsecPerCentury).toFixed(2)})`);
}

console.log("\n=== determinism: two identical runs ===");
const a = solarSystemAt(jdTdb(J2000_JD));
const b = solarSystemAt(jdTdb(J2000_JD));
advance(a, 37 * YEAR, limits);
advance(b, 37 * YEAR, limits);
let identical = a.state.length === b.state.length;
let worst = 0;
for (let i = 0; i < a.state.length; i++) {
  if (a.state[i] !== b.state[i]) identical = false;
  worst = Math.max(worst, Math.abs(a.state[i] - b.state[i]));
}
console.log("bit-identical after 37 years:", identical, "| worst difference:", worst);
console.log("energy drift:", base.energyDrift.toExponential(2));
