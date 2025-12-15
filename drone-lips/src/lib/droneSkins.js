export const DEFAULT_DRONE_SKIN_ID = 'classic';

// Notes:
// - If `modelUrl` does not exist (404), the game will fall back to the procedural drone.
// - Place optional GLBs in:
//   - public/assets/models/drone.glb (legacy "classic")
//   - public/assets/models/drones/<id>.glb (other skins)
// - Preview images are in public/assets/drones/
// - Optional per-skin alignment fields:
//   - position: [x, y, z]
//   - rotation: [x, y, z] (radians)
export const DRONE_SKINS = [
  {
    id: 'classic',
    name: 'Classic',
    preview: '/assets/drones/drone.png',
    // Keep backwards compatibility with the earlier single-model path.
    modelUrl: '/assets/models/drone.glb',
    scale: 1.25,
    palette: {
      hull: '#b8c2d0',
      panel: '#1a1f2a',
      frame: '#7c8799',
      glow: '#ffd24a',
      glowIntensity: 3.5,
      metalness: 0.9,
      roughness: 0.25,
    },
  },
  {
    id: 'defender',
    name: 'Defender',
    preview: '/assets/drones/defender.png',
    modelUrl: '/assets/models/drones/defender.glb',
    scale: 1.25,
    palette: {
      hull: '#d8e6ff',
      panel: '#0e1626',
      frame: '#86a2c8',
      glow: '#39d0ff',
      glowIntensity: 3.1,
      metalness: 0.92,
      roughness: 0.22,
    },
  },
  {
    id: 'drone2',
    name: 'Drone 2',
    preview: '/assets/drones/drone2.jpg',
    modelUrl: '/assets/models/drones/drone2.glb',
    scale: 1.25,
    palette: {
      hull: '#ffd1a8',
      panel: '#1c140f',
      frame: '#c7a07b',
      glow: '#ff6b3d',
      glowIntensity: 3.3,
      metalness: 0.88,
      roughness: 0.3,
    },
  },
  {
    id: 'drone3',
    name: 'Drone 3',
    preview: '/assets/drones/drone3.png',
    modelUrl: '/assets/models/drones/drone3.glb',
    scale: 1.25,
    palette: {
      hull: '#c8ffd8',
      panel: '#102017',
      frame: '#73c99b',
      glow: '#00ff96',
      glowIntensity: 2.9,
      metalness: 0.86,
      roughness: 0.35,
    },
  },
  {
    id: 'the-lord',
    name: 'The Lord',
    preview: '/assets/drones/the-lord.webp',
    modelUrl: '/assets/models/drones/the-lord.glb',
    scale: 1.25,
    palette: {
      hull: '#f2d27a',
      panel: '#2a1b0f',
      frame: '#caa24a',
      glow: '#a07bff',
      glowIntensity: 3.2,
      metalness: 0.95,
      roughness: 0.28,
    },
  },
  {
    id: 'enemies',
    name: 'Enemies',
    preview: '/assets/drones/enemies.jpeg',
    modelUrl: '/assets/models/drones/enemies.glb',
    scale: 1.25,
    palette: {
      hull: '#bdbdbd',
      panel: '#121212',
      frame: '#8a8a8a',
      glow: '#ff4b4b',
      glowIntensity: 3.6,
      metalness: 0.85,
      roughness: 0.35,
    },
  },
  {
    id: 'enemis2',
    name: 'Enemis 2',
    preview: '/assets/drones/enemis2.webp',
    modelUrl: '/assets/models/drones/enemis2.glb',
    scale: 1.25,
    palette: {
      hull: '#d3d0ff',
      panel: '#140f2a',
      frame: '#8d84ff',
      glow: '#ff2ca6',
      glowIntensity: 3.4,
      metalness: 0.9,
      roughness: 0.32,
    },
  },
];

export function getDroneSkin(id) {
  const found = DRONE_SKINS.find((s) => s.id === id);
  return found || DRONE_SKINS[0];
}
