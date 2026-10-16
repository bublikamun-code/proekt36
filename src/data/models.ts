import type { ModelAsset } from '../domain/types'

/**
 * CAD models that ship with the application. They are served from /public and cache by
 * URL, so they never touch IndexedDB. A product binds to one through DeviceDefinition.modelId.
 *
 * Every embedded model is pre-oriented: height along +Y, face toward +Z, centred, metres —
 * so the thumbnail stage needs no rotation. The CHINT NB set comes from the manufacturer
 * STEP files of the series (tessellated at 0.3 mm, DIN side toward -Z).
 */
const CHINT_MODELS: Array<[id: string, name: string]> = [
  ['chint-nb1-63-1p', 'CHINT NB1-63 1P'],
  ['chint-nb1-63-2p', 'CHINT NB1-63 2P'],
  ['chint-nb1-63-3p', 'CHINT NB1-63 3P'],
  ['chint-nb1-63-4p', 'CHINT NB1-63 4P'],
  ['chint-nbh8-40-1pn', 'CHINT NBH8-40 1P+N'],
  ['chint-nb1l-1pn-36', 'CHINT NB1L 1P+N 36мм'],
  ['chint-nb1l-2p-54', 'CHINT NB1L 2P 54мм'],
  ['chint-nb1l-40-2p', 'CHINT NB1L-40 2P'],
  ['chint-nb1l-40-3p', 'CHINT NB1L-40 3P'],
  ['chint-nb1l-40-4p', 'CHINT NB1L-40 4P'],
  ['chint-nb1l-63-2p', 'CHINT NB1L-63 2P'],
  ['chint-nb1l-63-4p', 'CHINT NB1L-63 4P'],
  ['chint-nb2le-1pn', 'CHINT NB2LE 1P+N'],
  ['chint-nb310l-3pn', 'CHINT NB310L 3P+N'],
  ['chint-nbh8le-40-1pn', 'CHINT NBH8LE-40 1P+N'],
]

export const embeddedModelAssets: ModelAsset[] = CHINT_MODELS.map(([id, name]) => ({
  id,
  name,
  source: 'embedded' as const,
  url: `/models/${id}.glb`,
  format: 'glb' as const,
  transform: { scale: 1, rotationY: 0 },
  createdAt: '2026-09-29T00:00:00.000Z',
}))

export const embeddedModelById = new Map(embeddedModelAssets.map((asset) => [asset.id, asset]))
