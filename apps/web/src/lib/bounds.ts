/** A bbox grown by `factor` of its own width/height on every side, for map maxBounds (the limit on how far you can pan or zoom out). */
export const padBounds = (b: [number, number, number, number], factor: number): [[number, number], [number, number]] => {
  const dx = (b[2] - b[0]) * factor
  const dy = (b[3] - b[1]) * factor
  return [[b[0] - dx, b[1] - dy], [b[2] + dx, b[3] + dy]]
}
