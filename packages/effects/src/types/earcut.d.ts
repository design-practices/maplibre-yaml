declare module "earcut" {
  /** earcut 3: triangulate a flat vertex array (with optional hole starts). */
  export default function earcut(
    data: ArrayLike<number>,
    holeIndices?: ArrayLike<number> | null,
    dim?: number
  ): number[];
}
