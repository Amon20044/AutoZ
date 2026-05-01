'use client'

/**
 * Three-point studio lighting: key, fill, rim.
 * Matches the PRD lighting spec for premium automotive visuals.
 */
export default function StudioLights() {
  return (
    <>
      {/* Ambient base */}
      <ambientLight color='#ffffff' intensity={0.35} />

      {/* Key light — main shadow caster */}
      <directionalLight
        position={[4, 6, -4]}
        intensity={2.2}
        color='#ffffff'
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />

      {/* Fill light — soft blue tint for depth */}
      <directionalLight
        position={[-4, 3, 3]}
        intensity={0.8}
        color='#dbeafe'
      />

      {/* Rim light — edge definition from behind */}
      <directionalLight
        position={[0, 4, 6]}
        intensity={1.1}
        color='#ffffff'
      />
    </>
  )
}
