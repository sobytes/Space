<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Do NOT push to git unless explicitly told to.

## Image attachments

When the user attaches an image (paste, screenshot, photo from their phone, Pexels, image picker), the desktop pipes an absolute file path into your prompt as plain text — and the image data is also on the system clipboard. **The file is real and readable right now.** Common locations:

- `$TMPDIR/vybecoding-clipboard/clip.<ext>` — the clipboard mirror, always present after a paste.
- `~/Downloads/...` or wherever the user originally got the image.
- Inside this project folder.

Do NOT tell the user "the image isn't accessible," "the attachment isn't local," or "I can't see it" when a file path appears in their message. Read the file first. If you need it as a stable project asset, copy it into `images/` or `public/` yourself — don't ask the user to move files manually.

When asked to build a website, default to Next.js (App Router) with Tailwind CSS, optimized for deployment on Vercel. Only use a different stack if the user explicitly requests one.

## Running the project

Always use port 3000 for dev servers. Before starting, kill anything already on that port:
- macOS/Linux: `lsof -ti:3000 | xargs kill -9 2>/dev/null; `
- Windows: `npx kill-port 3000 2>nul & `

Then start the dev server on port 3000. For common frameworks:
- Next.js: `npm run dev -- -p 3000`
- Vite: `npm run dev -- --port 3000`
- Create React App: `PORT=3000 npm start`
- Generic: set the port to 3000 in the config or via env var

Keep the server running. Do NOT open a browser window, the user has a built in preview panel that will auto detect the server URL. If a server is already running on a different port, stop it and restart on port 3000.


## How to think on this project

This is a physics instrument, not a landing page. The people below are here because each one
contributes a working habit, not because their names decorate a file. Where a habit conflicts
with shipping something that merely looks right, the habit wins.

**Newton: derive, then state it as mathematics.** The *Principia* does not describe gravity, it
gives you a quantity you can compute and check. Any claim this app makes about an orbit must
reduce to a number produced by a named function. "Hypotheses non fingo" is the operating rule.
Do not add a term the phenomena do not require. Newton also ground his own mirrors, so build the
instrument that does or proves the work rather than doing it by hand.

**Kepler: never discard the residual that does not fit.** Mars was off by eight arcminutes
against a circular orbit. Everyone else called that measurement error. Kepler spent years on
those eight arcminutes and got the ellipse. On this project, a small unexplained discrepancy
in a gate is the most valuable signal available. Chase it, do not widen the tolerance.

**Einstein: demand a falsifiable number, and prefer the simpler account.** General relativity
earned belief because it produced 43 arcseconds per century, a figure that could have been
wrong and was not. Every demonstration in this app must name a published value it can fail
against. Simplify until the mechanism is visible, and no further.

**Noether: symmetry is a conservation law, and a conservation law is a test.** Energy and
angular momentum conservation are not decoration on the integrator, they are how we detect that
it is lying. Any propagator ships with its conservation check.

**Gauss: estimate with error bars, and say what you do not know.** He recovered Ceres from a few
scraps of observation by inventing least squares and being explicit about uncertainty. Numbers in
this app carry their provenance and their error. A figure without an error bar is a guess wearing
a lab coat.

**Laplace and Lagrange: perturbation is the real world.** The two-body solution is the opening
move, not the answer. Where a perturbing term matters, include it and quantify what it was worth.

**Tesla: visualize the whole mechanism, and love resonance.** He ran machines to completion in his
head before touching metal, which is the right way to approach a simulation's architecture. Orbital
resonance is genuinely central here, from the Laplace resonance of Io, Europa and Ganymede to the
Kirkwood gaps. Tesla also carries a warning worth keeping: when his claims outran his published
evidence, the work suffered for it. Show the calculation.

**Feynman: the first principle is that you must not fool yourself.** If a result arrives too
easily, suspect the measurement before believing the system. If you cannot explain a mechanism
plainly, you do not yet understand it, and the explanation in the UI will be wrong too.

**Katherine Johnson: check the machine's answer.** She recomputed trajectories by hand because a
computed number is a claim until someone verifies it. That is this project's entire posture. Every
engine output has a gate, and the gate compares against an independent published source rather
than against our own earlier output.

**Vera Rubin: trust a clean measurement over a comfortable consensus.** Her rotation curves were
right and the field was wrong. If a gate says our model disagrees with expectation, report the
disagreement rather than massaging it.

### What this means in practice

- Every physical claim traces to a function, and that function traces to a gate.
- Every gate compares against a published external value, with its citation in the file.
- The AI layer explains numbers. It never produces them.
- A failing test is a finding to report, never a tolerance to loosen.
- State the measurement, the run count, the spread, and the limiter. A number without those
  is not yet evidence.
