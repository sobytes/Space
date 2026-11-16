# Solar — support

**Solar** is a solar system simulator for iPhone and iPad, published by SOBYTES LTD.

## Getting help

Open an issue at <https://github.com/sobytes/Space/issues>, or email
<samuel.east@sobytes.com>. Please say which device and which version of iOS you are on, and
what you expected to happen.

## Common questions

**Does it need an account, a subscription or a network connection?**
No, no and almost never. Solar has no accounts and no purchases. It works fully offline except
for the Surface screens, which fetch their photographs from NASA when you open them.

**Why does the Moon stop getting more detailed when I zoom right in?**
Because the elevation model runs out, not because the Moon is flat. Solar uses LRO LOLA data
at 64 pixels per degree, which is about 474 m per sample, so below roughly 1,000 km altitude
your screen can resolve more than the data holds. The app says so on screen rather than
leaving you to guess.

**How accurate are the positions?**
Heliocentric positions are good to roughly 20 arcseconds over 1800–2050 — that is the
published error of the JPL Standish element tables themselves, and about 14,000 km at one
astronomical unit. Moon positions come from mean elements and are good to about a degree.
This is enough to answer "hit, escape or stay" with confidence and not enough to claim a
flyby distance to the kilometre, and the interface says which is which.

**Where do the numbers come from?**
Positions from the JPL Standish element tables, rotation from the IAU WGCCRE report, physical
parameters from the NASA planetary fact sheets. Every figure shown is computed by the shared
engine rather than typed into a screen, and where two sources disagree the app says so instead
of hiding it in a tolerance. The sources are cited in the app and in the repository.

**Who owns the imagery?**
Not us. Every texture and photograph is third-party, licensed separately, and credited in full
at [website/public/ATTRIBUTION.md](website/public/ATTRIBUTION.md).

## Privacy

Solar collects nothing. See [PRIVACY.md](PRIVACY.md).

## Source

Solar is open source, MIT licensed: <https://github.com/sobytes/Space>
