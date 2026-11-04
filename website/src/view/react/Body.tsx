"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  Group,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { BODY_CONTRACTS, type BodyId } from "@solar/engine/bodies/registry";
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
 * A body's texture, or null if it is not there.
 *
 * This used drei's `useTexture`, which suspends and then throws when a file is missing.
 * With no error boundary above it, one absent image took down the entire React tree: the
 * deployed site rendered, hit a 404 on `/textures/sun.jpg`, and the tab died with Chrome's
 * "This page couldn't load". A simulator that cannot start because one planet has no
 * photograph is the wrong trade, and the fallback was already written and simply never
 * reachable: the material below draws an untextured body at its measured geometric albedo
 * in its measured colour, which is an honest rendering rather than a broken one.
 *
 * So this loads the same way `useGlobalNormalMap` does and returns null on failure, which
 * makes a missing texture a degraded picture instead of a blank page. Textures are not in
 * the repository by design, so the deployed app has to survive without them.
 *
 * Colour space is set by hand because drei used to do it: a planet texture sampled as linear
 * reads washed out and slightly wrong, and it looks like a lighting bug for an hour.
 */
function useOptionalTexture(id: string | undefined): Texture | null {
  // The id travels with the texture so a body that switches map never shows the previous
  // one during the load. Earth alone does this, flipping between day and night.
  const [loaded, setLoaded] = useState<{ id: string; texture: Texture } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    new TextureLoader().load(
      textureUrl(id),
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        setLoaded({ id, texture });
      },
      undefined,
      // Swallowed deliberately. A missing texture is a known state with a designed
      // appearance, not an error anyone can act on, and three already logs the 404.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  return loaded && loaded.id === id ? loaded.texture : null;
}


/**
 * City lights on the night side.
 *
 * Earth's contract has carried a `nightTextureId` since the registry was written and nothing
 * rendered it, so the dark side was simply black. That is the half of the planet a child is
 * most likely to find interesting, and the lit cities are the clearest evidence a simulator can
 * give that the dark side is night rather than empty space.
 *
 * It cannot be an `emissiveMap`, which three adds unconditionally and would paint the lights
 * across the daylit hemisphere too. The mask has to come from the lighting geometry, so this
 * injects the term into the standard material: carry the fragment's world normal through as a
 * varying, dot it with the direction to the Sun, and fade the lights in across the terminator.
 *
 * The Sun direction is a single uniform rather than per-fragment, which treats the Sun as
 * infinitely far away. At Earth's distance the Sun subtends half a degree, so the error in the
 * terminator's position is under a quarter of a degree of latitude, far finer than the texture.
 *
 * The world normal uses mat3(modelMatrix) rather than a proper inverse transpose. That is exact
 * for uniform scale and wrong under shear; the only non-uniform scale here is oblateness, and
 * the largest is Saturn at 10%, which tilts a normal by at most a few degrees near 45 latitude.
 * Earth, the only body with a night map, is flattened by 0.3%.
 */
interface NightUniforms {
  readonly uSunDirection: { value: Vector3 };
  readonly uNightMap: { value: Texture | null };
  readonly uNightStrength: { value: number };
}

/** Points the lighting mask at the Sun. Called every frame, so no allocation. */
function aimAtSun(uniforms: NightUniforms, x: number, y: number, z: number): void {
  uniforms.uSunDirection.value.set(x, y, z);
}

/**
 * Patches the standard material's program to add the night map, masked by the lighting.
 *
 * Module scope on purpose, as with the two setters above. These mutate objects that outlive a
 * render, which is the documented `onBeforeCompile` and uniform contract, and doing it inline
 * in a hook body trips the immutability rule for a good general reason even though these
 * particular mutations are the intended pattern.
 */
function nightSideProgram(uniforms: NightUniforms, nightMap: Texture) {
  // Bound here rather than from an effect. An effect runs after three has already built and
  // bound the program, and a sampler uniform still holding null at that point is given three's
  // empty texture, which samples black. The result is a night side with no lights and no error
  // anywhere: the shader compiles, runs, and adds zero.
  uniforms.uNightMap.value = nightMap;

  return (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSunDirection = uniforms.uSunDirection;
    shader.uniforms.uNightMap = uniforms.uNightMap;
    shader.uniforms.uNightStrength = uniforms.uNightStrength;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSunFacingNormal;")
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n\tvSunFacingNormal = normalize(mat3(modelMatrix) * objectNormal);",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uSunDirection;\nuniform sampler2D uNightMap;\nuniform float uNightStrength;\nvarying vec3 vSunFacingNormal;",
      )
      /**
       * Added immediately after `opaque_fragment`, which is where the shader still holds
       * linear radiance, and before tone mapping and the sRGB encode that follow it.
       *
       * Injecting at the end of the chain instead, after both, costs about a factor of twenty
       * in apparent brightness: the texture is sampled with an automatic sRGB decode so the
       * value is linear, and adding a linear 0.05 to an already-encoded pixel is invisible.
       * It takes a strength near 25 to see anything that way, which is the symptom of adding
       * in the wrong space rather than of a texture that is too dark. Here the lights are
       * tone-mapped along with everything else, which is also what makes them hold up when
       * the exposure changes.
       */
      .replace(
        "#include <opaque_fragment>",
        [
          "#include <opaque_fragment>",
          "float sunFacing = dot(normalize(vSunFacingNormal), normalize(uSunDirection));",
          // Widened slightly either side of the geometric terminator. A hard edge reads as a
          // rendering seam; the real one is softened by atmosphere over roughly this width.
          "float nightAmount = smoothstep(0.12, -0.08, sunFacing);",
          "vec3 cityLights = texture2D(uNightMap, vMapUv).rgb;",
          "gl_FragColor.rgb += cityLights * nightAmount * uNightStrength;",
        ].join("\n\t"),
      );
  };
}

/** Distinguishes the night-side program from the stock one in three's program cache. */
const nightCacheKey = () => "solar-night-side-v1";

function useNightSide(bodyId: BodyId, nightMap: Texture | null) {
  const viewport = useViewport();
  const uniforms = useMemo<NightUniforms>(
    () => ({
      uSunDirection: { value: new Vector3(0, 0, 1) },
      uNightMap: { value: null },
      uNightStrength: { value: 2.2 },
    }),
    [],
  );

  useFrame(() => {
    if (!nightMap) return;
    const sun = viewport.sunDirectionFor(bodyId);
    aimAtSun(uniforms, sun.x, sun.y, sun.z);
  });

  return useMemo(
    () => (nightMap ? nightSideProgram(uniforms, nightMap) : undefined),
    [nightMap, uniforms],
  );
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
  const night = useOptionalTexture(contract.appearance.nightTextureId);
  const applyNightSide = useNightSide(id, night);

  useEffect(() => {
    if (!group.current) return;
    return viewport.attach(id, group.current);
  }, [viewport, id]);

  /**
   * Geometric albedo is the fraction of light a body reflects straight back, and the spread is
   * large: Enceladus is near 0.99 while Callisto is 0.22. Folding it into the material colour
   * makes that spread visible instead of flattening every untextured body to the same grey.
   */
  const untexturedColour = useMemo(() => {
    const tint = new Color(contract.appearance.tint);
    return tint.multiplyScalar(Math.min(1, contract.geometricAlbedo / 0.99 + 0.12));
  }, [contract.appearance.tint, contract.geometricAlbedo]);

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
            // Changing the injected program needs a fresh material, since three compiles
            // onBeforeCompile once and caches the result against the material.
            key={applyNightSide ? "night" : "plain"}
            onBeforeCompile={applyNightSide}
            /**
             * Without this the injection silently does nothing.
             *
             * Three caches compiled programs by a key built from the material's parameters, and
             * `onBeforeCompile` is not part of that key. Every textured planet here produces the
             * same parameter set, so Earth was handed a program already compiled for one of the
             * others and the night map never reached the shader. Nothing errors, the planet just
             * renders without it, which is the hardest kind of failure to notice.
             */
            customProgramCacheKey={applyNightSide ? nightCacheKey : undefined}
            map={albedo ?? undefined}
            // The global normal map comes from real elevation data, so craters shade correctly
            // through the terminator at orbital range. Close range switches to tiles below.
            normalMap={globalNormal ?? undefined}
            // A body with no imagery is drawn at its measured geometric albedo in its measured
            // colour, rather than as a white sphere. That is why Io reads sulphur yellow,
            // Europa bright ice and Callisto dark: the brightness difference between them is
            // real data, not styling. Scaled so Enceladus at 0.99 stays just under clipping.
            color={albedo ? "#ffffff" : untexturedColour}
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
