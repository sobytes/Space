"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTexture } from "@react-three/drei";
import { AdditiveBlending, BackSide, DoubleSide, Group, TextureLoader, type Texture } from "three";
import { BODY_CONTRACTS, type BodyId } from "@/engine/bodies/registry";
import { TerrainTiles, useTerrainManifest } from "./TerrainTiles";
import { useViewport } from "./ViewportContext";

/**
 * Textures are named by the body contract and the contract gate already proved those names
 * exist in the asset manifest, so a missing file here is a download problem rather than a typo.
 */
function textureUrl(id: string): string {
  const extension = id === "saturn-ring" ? "png" : "jpg";
  return `/textures/${id}.${extension}`;
}

/**
 * drei's loader sets the colour space from the file rather than leaving it at the default,
 * which matters: a planet texture sampled as linear reads washed out and slightly wrong, and
 * it is the kind of error that looks like a lighting problem for an hour.
 *
 * A body with no cloud or ring map still has to call the hook, so an absent id loads the Sun
 * and the result is discarded. Hooks cannot be conditional, and the texture is cached anyway.
 */
function useOptionalTexture(id: string | undefined): Texture | null {
  const loaded = useTexture(id ? textureUrl(id) : "/textures/sun.jpg");
  return id ? (loaded as Texture) : null;
}

/**
 * A body declares how it looks. It never says where it is: the group's transform is written
 * exclusively by the Viewport, and `matrixAutoUpdate` is switched off on attach so three.js
 * cannot overwrite it either.
 *
 * Geometry is a unit sphere scaled by the Viewport to the body's real equatorial radius, so
 * every body in the scene shares one mesh shape and one source of truth for its size.
 */
export function Body({ id, segments = 96 }: { id: BodyId; segments?: number }) {
  const viewport = useViewport();
  const group = useRef<Group>(null);
  const contract = BODY_CONTRACTS[id];

  const terrain = useTerrainManifest(id);
  const globalNormal = useGlobalNormalMap(id, terrain !== null);
  const albedo = useOptionalTexture(contract.appearance.albedoTextureId);
  const clouds = useOptionalTexture(contract.appearance.cloudTextureId);
  const ring = useOptionalTexture(contract.appearance.ringSystem?.textureId);

  useEffect(() => {
    if (!group.current) return;
    return viewport.attach(id, group.current);
  }, [viewport, id]);

  const flattening = useMemo(
    () => contract.polarRadiusM / contract.equatorialRadiusM,
    [contract.polarRadiusM, contract.equatorialRadiusM],
  );

  const ringGeometry = contract.appearance.ringSystem;

  return (
    <group ref={group}>
      {terrain ? <TerrainTiles body={id} bodyGroupRef={group} manifest={terrain} /> : null}
      {/* Oblateness is real and visible on Saturn, which is 10% wider than it is tall. */}
      <mesh scale={[1, flattening, 1]} castShadow={!contract.appearance.emissive} receiveShadow={!contract.appearance.emissive}>
        <sphereGeometry args={[1, segments, segments / 2]} />
        {contract.appearance.emissive ? (
          <meshBasicMaterial map={albedo ?? undefined} toneMapped={false} color="#fff3d0" />
        ) : (
          <meshStandardMaterial
            map={albedo ?? undefined}
            // The global normal map comes from real elevation data, so craters shade correctly
            // through the terminator at orbital range. Close range switches to tiles below.
            normalMap={globalNormal ?? undefined}
            roughness={0.95}
            metalness={0}
          />
        )}
      </mesh>

      {clouds ? (
        <mesh scale={[1.012, flattening * 1.012, 1.012]}>
          <sphereGeometry args={[1, segments, segments / 2]} />
          <meshStandardMaterial map={clouds} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ) : null}

      {/*
        The Sun's light rides inside the Sun's own group, so it lands at the Sun's render-space
        position automatically. Putting it at (0,0,0) in the scene would place it inside
        whatever body the camera is focused on, because the floating origin tracks the focus
        rather than the Sun, which is exactly the bug that left Earth and Mars unlit.

        decay is zero because physical inverse-square falloff over 1e11 metres underflows to
        nothing at any sane intensity. Irradiance is modelled properly in the demonstrations;
        this light exists to make the terminator read correctly.
      */}
      {contract.appearance.emissive ? (
        <pointLight position={[0, 0, 0]} intensity={4.2} decay={0} color="#fff4e0" castShadow />
      ) : null}

      {contract.appearance.emissive ? (
        <mesh scale={1.35}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshBasicMaterial color="#ffb347" transparent opacity={0.12} side={BackSide} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ) : null}

      {ringGeometry && ring ? (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry
            args={[
              ringGeometry.innerRadiusM / contract.equatorialRadiusM,
              ringGeometry.outerRadiusM / contract.equatorialRadiusM,
              180,
            ]}
          />
          <meshBasicMaterial
            map={ring}
            transparent
            opacity={ringGeometry.opacity}
            side={DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Loads a body's global normal map when it has one.
 *
 * Separate from `useOptionalTexture` because terrain is optional per body and a missing file
 * must not suspend the whole scene. Bodies without elevation data simply render unlit relief,
 * which is honest: we do not have the data, so we do not invent it.
 */
function useGlobalNormalMap(body: string, hasTerrain: boolean): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!hasTerrain) return;
    let cancelled = false;
    const loader = new TextureLoader();
    loader.load(`/terrain/${body}/normal-global.jpg`, (loaded) => {
      if (cancelled) {
        loaded.dispose();
        return;
      }
      setTexture(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [body, hasTerrain]);

  // Derived rather than cleared in the effect, so no state is set synchronously there.
  return hasTerrain ? texture : null;
}
