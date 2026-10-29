/**
 * Choosing which surface tiles to draw, as pure arithmetic.
 *
 * Kept free of three.js so the selection logic can be gated as a unit test rather than judged
 * from a screenshot. Predicate P10 asks whether craters resolve from low altitude, and the
 * half of that question which is answerable numerically is "does the renderer pick a tile level
 * whose texel is finer than a screen pixel". That is this file.
 */

export interface PyramidLevel {
  readonly level: number;
  readonly tilesX: number;
  readonly tilesY: number;
  readonly levelWidth: number;
  readonly levelHeight: number;
  readonly metresPerTexel: number;
}

export interface TerrainManifest {
  readonly body: string;
  readonly tileSize: number;
  readonly levels: readonly PyramidLevel[];
  readonly globalNormalMap: string;
  readonly globalWidth: number;
  readonly referenceRadiusM: number;
  readonly elevationRangeM: readonly [number, number];
  readonly source: string;
}

export interface TileId {
  readonly level: number;
  readonly x: number;
  readonly y: number;
}

/** Metres on the surface covered by one screen pixel at the given altitude. */
export function metresPerPixel(
  altitudeM: number,
  verticalFovRadians: number,
  viewportHeightPx: number,
): number {
  return (2 * Math.max(altitudeM, 1) * Math.tan(verticalFovRadians / 2)) / viewportHeightPx;
}

/**
 * The coarsest level whose texel is at least as fine as a screen pixel.
 *
 * Coarsest rather than finest, deliberately. Going finer than the screen can resolve costs
 * texture memory and download time for detail nobody can see, which is the same mistake as
 * shipping an 8K texture for a body that is four pixels across.
 */
export function levelFor(
  manifest: TerrainManifest,
  altitudeM: number,
  verticalFovRadians: number,
  viewportHeightPx: number,
): PyramidLevel {
  const target = metresPerPixel(altitudeM, verticalFovRadians, viewportHeightPx);
  for (const level of manifest.levels) {
    if (level.metresPerTexel <= target) return level;
  }
  return manifest.levels[manifest.levels.length - 1];
}

/** Half-angle of the surface cap a camera at this altitude can see, radians. */
export function visibleCapAngle(radiusM: number, altitudeM: number): number {
  const r = radiusM;
  const d = r + Math.max(altitudeM, 1);
  // The horizon sits where the line of sight is tangent to the sphere.
  return Math.acos(Math.min(1, r / d));
}

export interface SubCameraPoint {
  /** Radians, -pi/2 at the south pole. */
  readonly latitude: number;
  /** Radians, 0 to 2pi. */
  readonly longitude: number;
}

/**
 * Tiles intersecting the visible cap, capped in count.
 *
 * The budget exists because a camera just above the surface sees a tiny cap but a camera far
 * out sees a hemisphere, and at a deep level a hemisphere is thousands of tiles. When the cap
 * needs more than the budget the caller should be at a coarser level, so returning a clamped
 * set is the honest failure mode rather than queueing a thousand downloads.
 */
export function tilesInView(
  level: PyramidLevel,
  centre: SubCameraPoint,
  capAngle: number,
  budget = 24,
): TileId[] {
  const latSpan = capAngle;
  // Longitude span widens with latitude; near a pole the whole ring is visible.
  const cosLat = Math.cos(centre.latitude);
  const lonSpan =
    Math.abs(cosLat) < 1e-6 || capAngle >= Math.PI / 2
      ? Math.PI
      : Math.min(Math.PI, Math.asin(Math.min(1, Math.sin(capAngle) / Math.abs(cosLat))));

  const latToRow = (lat: number) =>
    Math.min(level.tilesY - 1, Math.max(0, Math.floor(((Math.PI / 2 - lat) / Math.PI) * level.tilesY)));
  const lonToCol = (lon: number) => {
    const wrapped = ((lon % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.min(level.tilesX - 1, Math.floor((wrapped / (2 * Math.PI)) * level.tilesX));
  };

  const rowTop = latToRow(Math.min(Math.PI / 2, centre.latitude + latSpan));
  const rowBottom = latToRow(Math.max(-Math.PI / 2, centre.latitude - latSpan));

  const tiles: TileId[] = [];
  const colCentre = lonToCol(centre.longitude);
  const colRadius = Math.ceil((lonSpan / (2 * Math.PI)) * level.tilesX);

  for (let row = rowTop; row <= rowBottom; row++) {
    for (let offset = -colRadius; offset <= colRadius; offset++) {
      const col = ((colCentre + offset) % level.tilesX + level.tilesX) % level.tilesX;
      if (tiles.some((t) => t.x === col && t.y === row)) continue;
      tiles.push({ level: level.level, x: col, y: row });
      if (tiles.length >= budget) return tiles;
    }
  }

  return tiles;
}

/** The sphere-segment extent a tile covers, in the parameters SphereGeometry takes. */
export function tileExtent(level: PyramidLevel, tile: TileId) {
  return {
    phiStart: (tile.x / level.tilesX) * 2 * Math.PI,
    phiLength: (2 * Math.PI) / level.tilesX,
    thetaStart: (tile.y / level.tilesY) * Math.PI,
    thetaLength: Math.PI / level.tilesY,
  };
}

export function tileUrl(body: string, tile: TileId): string {
  return `/terrain/${body}/${tile.level}/${tile.x}-${tile.y}.jpg`;
}
