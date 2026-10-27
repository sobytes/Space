"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, PerspectiveCamera, SRGBColorSpace, TextureLoader, Vector3, type Texture } from "three";
import { BODY_CONTRACTS, type BodyId } from "@/engine/bodies/registry";
import {
  levelFor,
  tileExtent,
  tileUrl,
  tilesInView,
  visibleCapAngle,
  type TerrainManifest,
  type TileId,
} from "../core/tiles";

/**
 * Streamed surface tiles, so craters survive close zoom.
 *
 * A global normal map at 8192 wide is 1,332 m per texel on the Moon, which the screen out-
 * resolves below about 1,700 km. Past that point no global texture of any practical size helps,
 * so the surface switches to a quadtree of normal maps built from the LOLA elevation model and
 * loads only the tiles the camera can actually see.
 *
 * Tiles are sphere segments rather than a projected patch. SphereGeometry takes phi and theta
 * ranges directly and generates UVs spanning the segment, so an equirectangular tile maps onto
 * its own piece of the globe with no seam maths and no custom shader.
 *
 * The selection logic lives in `core/tiles.ts` as pure arithmetic and is gated there. This
 * component is the wiring.
 */

const MAX_CACHED_TILES = 64;

export function useTerrainManifest(body: BodyId): TerrainManifest | null {
  const [manifest, setManifest] = useState<TerrainManifest | null>(null);

  useEffect(() => {
    let cancelled = false;

    // No synchronous reset here. Setting state synchronously inside an effect cascades a
    // render, and the only reason to do it would be to clear a stale manifest, which the
    // body-keyed resolution below already handles.
    void fetch(`/terrain/${body}/manifest.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setManifest(data as TerrainManifest | null);
      })
      .catch(() => {
        // A body with no terrain data simply renders without tiles.
      });

    return () => {
      cancelled = true;
    };
  }, [body]);

  return manifest;
}

/** Loads tile textures once and keeps a bounded cache, so panning does not refetch. */
function useTileCache() {
  const cache = useRef(new Map<string, Texture>());
  const loader = useMemo(() => new TextureLoader(), []);
  const [, force] = useState(0);

  const get = (url: string): Texture | null => {
    const existing = cache.current.get(url);
    if (existing) return existing;

    loader.load(url, (texture) => {
      texture.colorSpace = SRGBColorSpace;
      if (cache.current.size >= MAX_CACHED_TILES) {
        const oldest = cache.current.keys().next().value;
        if (oldest) {
          cache.current.get(oldest)?.dispose();
          cache.current.delete(oldest);
        }
      }
      cache.current.set(url, texture);
      force((n) => n + 1);
    });

    return null;
  };

  useEffect(() => {
    const current = cache.current;
    return () => {
      for (const texture of current.values()) texture.dispose();
      current.clear();
    };
  }, []);

  return get;
}

export function TerrainTiles({
  body,
  bodyGroupRef,
  manifest,
}: {
  body: BodyId;
  /** The ref itself, not its current value: reading a ref during render is a React violation. */
  bodyGroupRef: React.RefObject<Group | null>;
  manifest: TerrainManifest | null;
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const getTile = useTileCache();
  const [visible, setVisible] = useState<{ level: number; tiles: TileId[] } | null>(null);

  const radius = BODY_CONTRACTS[body].equatorialRadiusM;
  const scratch = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const bodyGroup = bodyGroupRef.current;
    if (!manifest || !bodyGroup) return;

    // The camera in the body's own rotating frame, so a tile stays over its own terrain as
    // the body spins rather than sliding across the surface.
    scratch.copy(camera.position);
    bodyGroup.worldToLocal(scratch);

    // The group is scaled to the body's radius, so local length is in radii.
    const radii = scratch.length();
    if (!Number.isFinite(radii) || radii <= 1) return;

    const altitudeM = (radii - 1) * radius;
    const globalTexel = (2 * Math.PI * radius) / manifest.globalWidth;
    const pixel = (2 * altitudeM * Math.tan((camera.fov * Math.PI) / 360)) / size.height;

    // Above the crossover the global map is already finer than the screen, so tiles would be
    // downloading detail nobody can see.
    if (pixel >= globalTexel) {
      if (visible !== null) setVisible(null);
      return;
    }

    const level = levelFor(manifest, altitudeM, (camera.fov * Math.PI) / 180, size.height);
    const direction = scratch.normalize();
    const centre = {
      latitude: Math.asin(Math.max(-1, Math.min(1, direction.y))),
      longitude: Math.atan2(direction.z, direction.x),
    };
    const tiles = tilesInView(level, centre, visibleCapAngle(radius, altitudeM));

    const changed =
      visible === null ||
      visible.level !== level.level ||
      visible.tiles.length !== tiles.length ||
      tiles.some((t, i) => t.x !== visible.tiles[i]?.x || t.y !== visible.tiles[i]?.y);

    if (changed) setVisible({ level: level.level, tiles });
  });

  if (!manifest || !visible) return null;
  const level = manifest.levels.find((l) => l.level === visible.level);
  if (!level) return null;

  return (
    <>
      {visible.tiles.map((tile) => {
        const texture = getTile(tileUrl(body, tile));
        if (!texture) return null;
        const extent = tileExtent(level, tile);

        return (
          <mesh key={`${tile.level}-${tile.x}-${tile.y}`} renderOrder={1}>
            <sphereGeometry
              args={[
                // A hair above the base sphere so the tile wins the depth test cleanly rather
                // than z-fighting with the body it sits on.
                1.0002,
                64,
                32,
                extent.phiStart,
                extent.phiLength,
                extent.thetaStart,
                extent.thetaLength,
              ]}
            />
            <meshStandardMaterial normalMap={texture} roughness={0.95} metalness={0} color="#b8b2a8" />
          </mesh>
        );
      })}
    </>
  );
}
