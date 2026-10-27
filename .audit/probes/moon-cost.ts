/**
 * What does including moons cost? A global adaptive step is set by the fastest body in the
 * system, so Phobos at 7.65 h paces everything. Measure it rather than assume.
 */
import { advance, solarSystemAt, totalEnergy, type MassiveBody } from "../../src/engine/nbody";
import { BODY_CONTRACTS, type BodyId } from "../../src/engine/bodies/registry";
import { heliocentricPositionOf } from "../../src/engine/bodies/position";
import { J2000_JD, jdTdb } from "../../src/engine/time";
import { SECONDS_PER_DAY } from "../../src/engine/units";
import { scale, sub } from "../../src/engine/vec";

const YEAR = 365.25 * SECONDS_PER_DAY;

/** Velocity by central difference, with the interval scaled to the body's own period. */
function stateOf(id: BodyId, epoch: number, periodDays: number): MassiveBody {
  const dtDays = periodDays / 20000;
  const before = heliocentricPositionOf(id, jdTdb(epoch - dtDays));
  const after = heliocentricPositionOf(id, jdTdb(epoch + dtDays));
  return {
    id,
    gm: BODY_CONTRACTS[id].gm,
    position: heliocentricPositionOf(id, jdTdb(epoch)),
    velocity: scale(sub(after, before), 1 / (2 * dtDays * SECONDS_PER_DAY)),
  };
}

const MOONS: readonly BodyId[] = Object.keys(BODY_CONTRACTS).filter((id) => {
  const e = BODY_CONTRACTS[id as BodyId].ephemeris;
  return e.kind === "mean-elements-about-parent";
}) as BodyId[];

console.log("moons in the registry:", MOONS.length);
const periods = MOONS.map((id) => {
  const e = BODY_CONTRACTS[id].ephemeris;
  return { id, days: e.kind === "mean-elements-about-parent" ? e.periodDays : NaN };
}).sort((a, b) => a.days - b.days);
console.log("fastest three:", periods.slice(0, 3).map((p) => `${p.id} ${p.days.toFixed(3)} d`).join(", "));
console.log("slowest       :", `${periods.at(-1)!.id} ${periods.at(-1)!.days.toFixed(1)} d`);

const SETS: readonly { name: string; moons: readonly BodyId[] }[] = [
  { name: "planets only", moons: [] },
  { name: "+ Earth's Moon", moons: ["moon"] },
  { name: "+ Galileans", moons: ["io", "europa", "ganymede", "callisto"] },
  { name: "+ Titan", moons: ["titan"] },
  { name: "+ Phobos & Deimos", moons: ["phobos", "deimos"] },
  { name: "all 23 moons", moons: MOONS },
];

const SPAN_DAYS = 30;
console.table(SETS.map(({ name, moons }) => {
  const epoch = J2000_JD;
  const extra = moons.map((id) => {
    const e = BODY_CONTRACTS[id].ephemeris;
    return stateOf(id, epoch, e.kind === "mean-elements-about-parent" ? e.periodDays : 1);
  });
  const sys = solarSystemAt(jdTdb(epoch), extra);
  const e0 = totalEnergy(sys);
  const t0 = Date.now();
  const { steps } = advance(sys, SPAN_DAYS * SECONDS_PER_DAY, {
    tolerance: 1e-12, minStepSeconds: 1, maxStepSeconds: 5 * SECONDS_PER_DAY,
  });
  const ms = Date.now() - t0;
  const drift = Math.abs((totalEnergy(sys) - e0) / e0);
  return {
    set: name,
    bodies: sys.ids.length,
    steps,
    "mean step (s)": ((SPAN_DAYS * SECONDS_PER_DAY) / steps).toFixed(0),
    "ms per 30 d": ms,
    "s per sim-century": ((ms / 1000) * (36525 / SPAN_DAYS)).toFixed(1),
    "energy drift": drift.toExponential(1),
  };
}));
