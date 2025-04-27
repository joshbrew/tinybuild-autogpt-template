import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Float, Html, Stars, Sparkles, Text, ContactShadows } from '@react-three/drei';

function Box() {
  return (
    <Float speed={2} rotationIntensity={2} floatIntensity={3}>
      <mesh castShadow receiveShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="hotpink" />
      </mesh>
      <Html center distanceFactor={2} style={{pointerEvents:'none'}}>
        <div style={{fontWeight:'bold',color:'#222'}}>✨ 3D Magic! ✨</div>
      </Html>
    </Float>
  );
}

function Sphere() {
  return (
    <Float speed={1.5} rotationIntensity={1.2} floatIntensity={1.7}>
      <mesh castShadow receiveShadow position={[-1.3, 0.3, 0.3]}>
        <sphereGeometry args={[0.48, 32, 32]} />
        <meshStandardMaterial color="#36f5c7" metalness={0.3} roughness={0.15} />
      </mesh>
      <Html center distanceFactor={2.5} style={{pointerEvents:'none'}}>
        <div style={{fontWeight:'bold',color:'#222'}}>🌟 Sphere!</div>
      </Html>
    </Float>
  );
}

function Torus() {
  return (
    <Float speed={1.15} rotationIntensity={2.3} floatIntensity={2.3}>
      <mesh castShadow receiveShadow position={[1.2, 0.3, 0.6]}>
        <torusGeometry args={[0.35, 0.13, 16, 42]} />
        <meshStandardMaterial color="#f24e79" metalness={0.67} roughness={0.25} />
      </mesh>
      <Html center distanceFactor={2.2} style={{pointerEvents:'none'}}>
        <div style={{fontWeight:'bold',color:'#222'}}>🌀 Donut!</div>
      </Html>
    </Float>
  );
}

export default function ShowOff() {
  return (
    <div style={{ width: '100%', maxWidth: 420, height: 380, margin: 'auto', borderRadius: 28, overflow: 'hidden', boxShadow: '0 0 32px 8px #0001', background: 'linear-gradient(120deg, #b2fefa 0%, #efeffd 100%)' }}>
      <Canvas shadows camera={{ position: [3.5, 2.5, 3.5], fov: 45 }}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[3,3,5]} intensity={1.7} castShadow shadow-bias={-0.0005}/>
        {/* Fun cosmic background & sparkly effects */}
        <Stars radius={8} depth={18} count={350} factor={0.52} saturation={0.7} fade/>
        <Sparkles count={50} color="#ff9efd" size={6} speed={0.85} opacity={0.8}/>
        {/* Show off three fun objects! */}
        <Box />
        <Sphere />
        <Torus />
        {/* 3D text in the air */}
        <Text position={[0, 2, 0]} fontSize={0.57} color="#214093" anchorX="center" anchorY="middle" bold>WOW!</Text>
        {/* Soft 3D shadow */}
        <ContactShadows position={[0, -0.01, 0]} opacity={0.28} blur={1.6} far={5} scale={7} />
        <OrbitControls enablePan={false} enableZoom={false} />
      </Canvas>
    </div>
  );
}
