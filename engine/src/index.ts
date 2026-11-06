/**
 * The engine's public surface.
 *
 * Everything a client needs to show a correct solar system, and nothing about how to show it.
 * There is no DOM, no renderer, no framework here, and the package's tsconfig leaves `dom` out
 * of `lib` so that stays true by compilation rather than by discipline. The same code runs in
 * a browser, in a Web Worker, in a Node route handler and in the gates, which is what lets a
 * test assert against the identical function the screen is drawing from.
 *
 * Deep imports work too (`@solar/engine/nbody`), and are the better choice inside the website
 * where tree shaking matters. This barrel is for clients that want the whole surface.
 */

export * from "./units";
export * from "./vec";
export * from "./time";
export * from "./kepler";
export * from "./elements";
export * from "./rotation";
export * from "./relativity";
export * from "./propagate";
export * from "./nbody";
export * from "./nbody-tracker";
export * from "./secular";
export * from "./habitability";
export * from "./labels";
export * from "./orbit-time";
export * from "./time-sense";
export * from "./when";
export * from "./solar-time";
export * from "./deep-time";
export * from "./surface-views";
export * from "./data/surface-imagery";
export * from "./data/habitability-environment";

export * from "./data/planets";
export * from "./data/physical";
export * from "./data/ephemeris-accuracy";
export * from "./data/nbody-expectations";

export * from "./bodies/contract";
export * from "./bodies/registry";
export * from "./bodies/position";
export * from "./bodies/laplace";

export * from "./demonstrations/registry";
