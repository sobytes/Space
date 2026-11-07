# Space

A solar system simulator built to be checked rather than admired. Positions come from the
JPL Standish element tables, rotation from the IAU WGCCRE report, and every number on screen
is produced by the shared engine rather than typed into a view. Where two sources disagree,
the body contract says so out loud instead of hiding it in a tolerance.

Two clients, one physics engine: a Next.js site and a native iPhone app. A conformance suite
of **797 cases across 23 domains** runs against both, so the TypeScript and the Swift port
cannot quietly drift apart.

## What it does

- **32 bodies** positioned from real ephemerides, with their own rotational elements, axial
  tilts and ring systems
- **Analytic or mutual gravity.** Switch between Standish rails and a full N-body integration
  with energy, momentum and angular-momentum drift shown on screen, because a viewer who
  cannot tell which mode they are in cannot trust either
- **Labels that point off screen.** Focused on Earth, the Moon is sixty radii away and simply
  not in frame; a pointer at the edge says which way it is, which nothing on screen can
- **Stand on the surface.** Real mission photographs from the five worlds ever photographed
  from their own surface, and an honest explanation for every body with none
- **Make it habitable.** What it would actually take, derived rather than asserted: energy
  balance, atmospheric escape, mirror areas, the lot
- **Terrain.** Real LRO LOLA elevation on the Moon, streamed as a tile pyramid

## Running it

```bash
npm install
npm run dev          # the site, on port 3000
./build.sh ios run   # the iPhone app, on a simulator
```

The simulation needs no configuration and no keys. Nothing here calls out to a paid service.

The planet imagery is already here, as the WebP files under `website/public/textures`: 2048
across for every body, 4096 for whichever one the camera is focused on, 12 MB in total. You
do not need to fetch anything to see real planets.

What is not here is the originals those were made from, 78 MB of 8192 x 4096 JPEGs. To change
a texture, or to regenerate the set, `npm run assets` downloads them into `website/assets/originals`
under the licences recorded in the manifest and `npm run textures` resizes them back into
`public/textures` and rewrites the credits page.

## How it is kept honest

```bash
./build.sh check            # every gate: engine, website, Swift port, cross-language drift
./build.sh website probe    # geometry, against a running dev server
./build.sh ios uitest       # launch the app and touch the controls
./build.sh citations        # re-resolve every cited DOI and check it says what we say
./build.sh imagery          # re-check every surface photograph is real and still served
```

**945 TypeScript tests, 43 Swift tests, 538 conformance cases.** Three of those commands are
worth explaining, because each exists for a failure the others could not see.

The **conformance suite** holds one set of expected answers that both clients must reproduce.
It caught two real defects the first time it ran.

The **probes** read geometry rather than pixels. A screenshot cannot tell a moon drawn in the
wrong place from one too small to see, and both look like nothing at all. The web client
shipped with the entire solar system rolled ninety degrees and every test green, because the
one view anyone checked was the single orientation where up does not matter.

The **interaction tests** launch the app and tap things. A control can render perfectly,
pass every arithmetic gate, and ignore every touch.

`./build.sh citations` and `./build.sh imagery` need the network and are deliberately outside
`check`: a gate that fails when the network is down teaches people to ignore gates. The first
one found a citation attributing Juno's magnetic field model to a 1992 volume of Nature.

## Layout

| | |
|---|---|
| `engine/` | the physics. No DOM, enforced by its own tsconfig rather than by discipline |
| `website/` | Next.js, the reference client |
| `mobile/ios/` | SwiftUI and SceneKit over SolarKit, a hand port of the engine |
| `contracts/` | what every client must agree about, and the gates that check it |

## Contracts

The engine is shared, the clients are not, so the agreements between them are written down
and tested. Twelve of them, including:

- **physics-and-mathematics** — the master contract: gravitation, orbits, perturbation,
  relativity, conservation, integration and uncertainty, each with its source
- **numbers-come-from-the-engine** — no client and no model states a figure the engine did
  not compute
- **feature-parity** — what the product does and which clients do it, backed by
  `features.json` and a gate. **27 of 28 features ship on both web and iOS**
- **units-and-frames** — SI inside, branded at the boundary, J2000 ecliptic, z is ecliptic
  north
- **floating-origin** — rendering ten orders of magnitude without jitter or clipping

Start with `contracts/README.md`.

## Accuracy, stated plainly

Heliocentric positions are good to roughly 20 arcseconds over 1800–2050, which is the
published error of the Standish tables themselves and about 14,000 km at one astronomical
unit. That is enough to answer "hit, escape or stay" with confidence and not enough to claim
a flyby distance to the kilometre, and the interface says so where it matters.

Moon positions come from mean elements and are good to about a degree. This is not an
eclipse-grade ephemeris and does not pretend to be.

## Licence

MIT, for the code. See [LICENSE](LICENSE). The imagery is not covered by it: every texture
served is third-party, is licensed separately, and has been resized from its original.
[website/public/ATTRIBUTION.md](website/public/ATTRIBUTION.md) names each one, its licence and
where it came from, and is generated from the files on disk so it cannot go stale.
