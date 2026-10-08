/** Ideas to start from: Holo gets the detailed prompt, the user sees the short label. */
export const SUGGESTIONS = [
  {
    label: "A hilltop castle",
    prompt:
      "A medieval castle crowning a rocky hill: a tall square keep off center, four round towers of different heights with conical slate roofs, and a gatehouse with a portcullis, a drawbridge and a winding approach road. Weathered curtain walls with crenellations, arrow slits and a wall walk; a courtyard with a well, a stable, market stalls and banners. Outcrops, ivy, scattered pines and a village of timber houses clinging to the slope below.",
  },
  {
    label: "A Japanese temple",
    prompt:
      "A Japanese Buddhist temple beside a koi pond: a two-tier main hall with deep curved eaves, dark timber posts, white plaster walls and a veranda on stone footings, a five-storey pagoda rising behind it, and a red torii gate at the end of a stone path. The pond has irregular rocky banks, a red arched bridge, lily pads and stone lanterns. Cherry trees in bloom, sculpted pines, moss, a raked gravel garden and a bamboo grove at the edge.",
  },
  {
    label: "A village square",
    prompt:
      "A cozy European village square on uneven cobblestones: a stone church with a tall bell tower and a spire, a tiered fountain in the middle, and a ring of crooked timber-framed houses with jettied upper floors, flower boxes, shutters, awnings and chimneys, each a different height and color. Market stalls with crates and barrels, a bakery with a lit window, lanterns on posts, benches, a big shade tree and narrow lanes leading out between the houses.",
  },
  {
    label: "A seaside lighthouse",
    prompt:
      "A tall striped lighthouse on a jagged rocky headland: a tapering round tower with a gallery, a railing and a glowing lantern room under a domed cap, and a keeper's cottage with a slate roof, a chimney and a small garden beside it. Waves breaking on layered cliffs, tide pools, a wooden jetty with a moored rowboat, stairs cut into the rock, wind-bent grass, driftwood, fishing nets and lamps along the path.",
  },
];

const LABELS = new Map(SUGGESTIONS.map((s) => [s.prompt, s.label]));

/** The short label of a suggestion's prompt, or undefined for anything else. */
export const label = (prompt: string): string | undefined => LABELS.get(prompt);
