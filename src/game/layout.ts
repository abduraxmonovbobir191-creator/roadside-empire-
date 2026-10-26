import { roundedPath, type Path } from "../sim/path";

/**
 * World layout (metres). The highway runs along X; traffic keeps right, so eastbound (+X)
 * uses z = +1.75 and the station sits on the +Z side of the road.
 */
export const ROAD_HALF = 3.5;
export const LANE = 1.75;
export const ROAD_END = 260;

export const FORECOURT = { x0: -40, x1: 40, z0: 5.5, z1: 26 };
export const ROWS = [12, 19.5];
export const ISLAND_Z = (ROWS[0] + ROWS[1]) / 2;
export const PUMP_X = [-12, 0, 12];
export const SHOP = { x: 0, z: 31, w: 22, d: 9 };
export const TILL = { x: 7, z: 25.2 };
export const MERGE_X = 50;

export type Slot = { index: number; row: number; x: number; z: number };

/** Slots in unlock order: front of each row first (cars never have to squeeze past a car that is filling up). */
export const SLOTS: Slot[] = [
  { index: 0, row: 0, x: PUMP_X[2], z: ROWS[0] },
  { index: 1, row: 1, x: PUMP_X[2], z: ROWS[1] },
  { index: 2, row: 0, x: PUMP_X[1], z: ROWS[0] },
  { index: 3, row: 1, x: PUMP_X[1], z: ROWS[1] },
  { index: 4, row: 0, x: PUMP_X[0], z: ROWS[0] },
  { index: 5, row: 1, x: PUMP_X[0], z: ROWS[1] },
];

export const EAST: Path = roundedPath(
  [
    { x: -ROAD_END, z: LANE },
    { x: ROAD_END, z: LANE },
  ],
  0,
);

export const WEST: Path = roundedPath(
  [
    { x: ROAD_END, z: -LANE },
    { x: -ROAD_END, z: -LANE },
  ],
  0,
);

/** Through the forecourt along one pump row and back onto the eastbound lane. */
export const ROW_PATHS: Path[] = ROWS.map((z) =>
  roundedPath(
    [
      { x: -ROAD_END, z: LANE },
      { x: -56, z: LANE },
      { x: -38, z: z - 2.5 },
      { x: -30, z },
      { x: 30, z },
      { x: 38, z: z - 2.5 },
      { x: MERGE_X, z: LANE },
      { x: ROAD_END, z: LANE },
    ],
    [9, 7, 7, 7, 7, 9],
  ),
);

/** Where a station car waits before joining the highway. */
export const GIVE_WAY: { x: number; z: number } = { x: 44, z: 6.4 };
