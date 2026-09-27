import type { ModelAsset } from '../domain/types'

/**
 * CAD models that ship with the application. They are served from /public and cache by
 * URL, so they never touch IndexedDB. A product binds to one through DeviceDefinition.modelId.
 */
export const embeddedModelAssets: ModelAsset[] = [
  {
    id: 'city9-mcb-2p',
    name: 'City9 MCB 2P',
    source: 'embedded',
    url: '/models/city9-mcb-2p.glb',
    format: 'glb',
    transform: { scale: 1, rotationY: -Math.PI / 2 },
    createdAt: '2026-09-25T00:00:00.000Z',
  },
]

export const embeddedModelById = new Map(embeddedModelAssets.map((asset) => [asset.id, asset]))
