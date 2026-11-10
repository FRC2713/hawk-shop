/**
 * How many robots the team builds each season. Releasing a part makes
 * `per robot × ROBOT_COUNT + spares` of it.
 */
export const ROBOT_COUNT = 2;

export function quantityToMake(perRobot: number, spares: number): number {
  return perRobot * ROBOT_COUNT + spares;
}
