/**
 * Photographs taken on, or from just above, the surfaces of other worlds.
 *
 * Asked for as a way to stand somewhere and look around, with real pictures rather than
 * anything generated. That constraint is the whole design, and it is harder than it sounds:
 * NASA's own image library is full of artist's impressions, mission concept art and computed
 * perspective views rendered from radar altimetry. A keyword search for "Venus surface"
 * returns a Magellan elevation model drawn as a landscape, which looks exactly like a
 * photograph of Venus and is not one.
 *
 * So nothing here is searched for at runtime. Every entry is a specific asset, checked by
 * hand, and `scripts/verify-imagery.mjs` re-resolves each one and refuses anything whose own
 * description calls it a concept, an illustration, a rendering or a perspective view.
 *
 * The honest part is the gaps. Five worlds have ever been photographed from their own
 * surface: Earth, the Moon, Mars, Venus and Titan. That is the entire list, in seventy years
 * of spaceflight, and a feature that quietly filled the rest with orbital imagery or artwork
 * would be teaching the opposite of the truth.
 *
 * The images are not redistributed. Each entry carries the URL NASA serves it from, resolved
 * at curation time because the size suffix is not predictable: some assets have `~large`,
 * some only `~orig`, and guessing produces a 403.
 */

import type { BodyId } from "../bodies/contract";

export interface SurfaceImage {
  /** NASA image library identifier, which is also how `verify-imagery` re-checks it. */
  readonly nasaId: string;
  readonly title: string;
  readonly mission: string;
  readonly instrument: string;
  /** ISO date the frame was taken, not the date NASA published it. */
  readonly captured: string;
  /** What a viewer is actually looking at, in a sentence. */
  readonly whatYouAreSeeing: string;
  readonly credit: string;
  readonly url: string;
}

export interface SurfaceImagery {
  /** Has anything ever photographed this world from its own surface? */
  readonly photographedFromSurface: boolean;
  readonly images: readonly SurfaceImage[];
  /** Said plainly where there is nothing, or little, to show. */
  readonly caveat?: string;
  /**
   * Where to go and look at images this project will not host.
   *
   * Venus is the case. The pictures exist, they are extraordinary, and the archive holding
   * them says in terms that they are not necessarily public domain. Linking is not copying,
   * so a reader can still see them, and nobody has to take this project's word for the
   * rights position.
   */
  readonly seeAlso?: { readonly label: string; readonly url: string };
}

const NASA_PD =
  "NASA/JPL-Caltech. Public domain; NASA asks to be credited and not to be implied as endorsing.";

export const SURFACE_IMAGERY: Partial<Record<BodyId, SurfaceImagery>> = {
  mars: {
    photographedFromSurface: true,
    images: [
      {
        nasaId: "PIA24422",
        title: "Perseverance Navcam 360-degree panorama",
        mission: "Mars 2020 Perseverance",
        instrument: "Navcam",
        captured: "2021-02-20",
        whatYouAreSeeing:
          "The floor of Jezero Crater, two days after landing, stitched from six Navcam frames "
          + "into a full turn of the horizon. The rim of the crater is the ridge on the skyline.",
        credit: NASA_PD,
        url: "https://images-assets.nasa.gov/image/PIA24422/PIA24422~medium.jpg",
      },
      {
        nasaId: "PIA16101",
        title: "Landing site panorama, with the heights of Mount Sharp",
        mission: "Mars Science Laboratory Curiosity",
        instrument: "Mastcam",
        captured: "2012-08-18",
        whatYouAreSeeing:
          "Gale Crater from Curiosity's landing site. Mount Sharp, the five-kilometre layered "
          + "mound in the middle distance, is the reason the crater was chosen: its layers are "
          + "a readable record of Martian climate.",
        credit: NASA_PD,
        url: "https://images-assets.nasa.gov/image/PIA16101/PIA16101~large.jpg",
      },
      {
        nasaId: "PIA25684",
        title: "Looking back at Perseverance's second science campaign",
        mission: "Mars 2020 Perseverance",
        instrument: "Mastcam-Z",
        captured: "2023-02-13",
        whatYouAreSeeing:
          "The remains of an ancient river delta in Jezero Crater, photographed looking back "
          + "across ground the rover had already crossed.",
        credit: NASA_PD,
        url: "https://images-assets.nasa.gov/image/PIA25684/PIA25684~large.jpg",
      },
    ],
  },

  moon: {
    photographedFromSurface: true,
    images: [
      {
        nasaId: "as11-40-5903",
        title: "Aldrin on the lunar surface",
        mission: "Apollo 11",
        instrument: "Hasselblad 500EL, 70 mm",
        captured: "1969-07-20",
        whatYouAreSeeing:
          "Buzz Aldrin beside a leg of the lunar module Eagle, in the Sea of Tranquillity. "
          + "Taken on film, by hand, by Neil Armstrong.",
        credit: "NASA. Public domain.",
        url: "https://images-assets.nasa.gov/image/as11-40-5903/as11-40-5903~large.jpg",
      },
      {
        nasaId: "as15-87-11849",
        title: "Mount Hadley from the Apollo 15 landing site",
        mission: "Apollo 15",
        instrument: "Hasselblad 500EL, 70 mm",
        captured: "1971-07-31",
        whatYouAreSeeing:
          "Mount Hadley, rising about 4.5 km above the plain at Hadley Rille. The lunar sky is "
          + "black at noon because there is no atmosphere to scatter sunlight.",
        credit: "NASA. Public domain.",
        url: "https://images-assets.nasa.gov/image/as15-87-11849/as15-87-11849~large.jpg",
      },
      {
        nasaId: "as17-145-22162",
        title: "Apollo 17, station 5, panoramic",
        mission: "Apollo 17",
        instrument: "Hasselblad 500EL, 70 mm",
        captured: "1972-12-12",
        whatYouAreSeeing:
          "The Taurus-Littrow valley, from the last crewed landing. Nobody has stood on another "
          + "world since this photograph was taken.",
        credit: "NASA. Public domain.",
        url: "https://images-assets.nasa.gov/image/as17-145-22162/as17-145-22162~large.jpg",
      },
    ],
  },

  titan: {
    photographedFromSurface: true,
    images: [
      {
        nasaId: "PIA07232",
        title: "First colour view of Titan's surface",
        mission: "Cassini-Huygens",
        instrument: "Huygens Descent Imager / Spectral Radiometer",
        captured: "2005-01-14",
        whatYouAreSeeing:
          "The ground where the Huygens probe came to rest, under an orange sky. The rounded "
          + "stones are water ice, hard as rock at 94 K, and their shapes suggest they were "
          + "moved by liquid. This is the only photograph ever taken from the surface of a "
          + "world in the outer solar system.",
        credit:
          "ESA/NASA/JPL/University of Arizona. Released for public use with attribution.",
        url: "https://images-assets.nasa.gov/image/PIA07232/PIA07232~orig.jpg",
      },
    ],
    caveat:
      "One image, from a probe that survived on the surface for 72 minutes. There has never "
      + "been another.",
  },

  embary: {
    photographedFromSurface: true,
    images: [
      {
        nasaId: "NHQ201708210116",
        title: "Total solar eclipse, Madras, Oregon",
        mission: "Photographed from the ground",
        instrument: "NASA/Aubrey Gemignani",
        captured: "2017-08-21",
        whatYouAreSeeing:
          "Thirteen exposures of the same eclipse, composited, from first contact through "
          + "totality and out again. Everything this simulation computes about orbits is "
          + "visible in one frame here: the Moon is 400 times smaller than the Sun and 400 "
          + "times closer, which is why the discs match almost exactly and why totality is a "
          + "few minutes wide on a track a hundred kilometres across.",
        credit: "NASA/Aubrey Gemignani. Public domain.",
        url: "https://images-assets.nasa.gov/image/NHQ201708210116/NHQ201708210116~medium.jpg",
      },
      {
        nasaId: "NHQ201708210101",
        title: "Baily's beads at the edge of totality",
        mission: "Photographed from the ground",
        instrument: "NASA/Aubrey Gemignani",
        captured: "2017-08-21",
        whatYouAreSeeing:
          "The last sunlight of the partial phase, broken into beads as it passes between "
          + "mountains on the Moon's limb. The beads are lunar topography, seen from 384,000 "
          + "km away, silhouetted against a star 150 million km beyond it.",
        credit: "NASA/Aubrey Gemignani. Public domain.",
        url: "https://images-assets.nasa.gov/image/NHQ201708210101/NHQ201708210101~large.jpg",
      },
    ],
    caveat:
      "The only world where a photograph from the surface is unremarkable. Everything else on "
      + "this list cost a spacecraft.",
  },

  venus: {
    photographedFromSurface: true,
    images: [],
    seeAlso: {
      label: "See the Venera surface photographs at NASA's NSSDCA archive",
      url: "https://nssdc.gsfc.nasa.gov/photo_gallery/photogallery-venus.html",
    },
    caveat:
      "Venus has been photographed from its surface, four times, by the Soviet Venera 9, 10, "
      + "13 and 14 landers between 1975 and 1982. Each survived between 23 and 127 minutes "
      + "before the heat and the pressure destroyed it, and nothing has landed since. "
      + "They are not shown here because the archive that holds them says they cannot be: "
      + "NASA's own NSSDCA, which hosts the scans, heads that section \u201cthe following "
      + "images were provided to NSSDCA by what is now the Russian Space Agency and are not "
      + "necessarily in the public domain\u201d. Linking is not copying, so the link above "
      + "goes straight to them. The absence is deliberate in the other direction too: a "
      + "Magellan radar map rendered as a landscape would look like a photograph of Venus and "
      + "would not be one.",
  },
};
