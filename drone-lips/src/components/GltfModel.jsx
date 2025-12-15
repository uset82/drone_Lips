import { useEffect, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function disposeMaterial(material) {
  if (!material) return;

  // Dispose common texture slots if present.
  const keys = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'aoMap',
    'emissiveMap',
    'alphaMap',
    'lightMap',
  ];

  for (const key of keys) {
    const tex = material[key];
    if (tex && typeof tex.dispose === 'function') tex.dispose();
  }

  if (typeof material.dispose === 'function') material.dispose();
}

function disposeObject3D(root) {
  if (!root) return;

  root.traverse((obj) => {
    if (obj.geometry && typeof obj.geometry.dispose === 'function') obj.geometry.dispose();

    const mat = obj.material;
    if (Array.isArray(mat)) {
      for (const m of mat) disposeMaterial(m);
    } else {
      disposeMaterial(mat);
    }
  });
}

export default function GltfModel({ url, fallback = null, ...props }) {
  const [scene, setScene] = useState(null);
  const mountedRef = useRef(true);
  const sceneRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;

    // Dispose previous scene when switching URLs.
    disposeObject3D(sceneRef.current);
    sceneRef.current = null;

    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        if (!mountedRef.current) return;

        sceneRef.current = gltf.scene;
        setScene(gltf.scene);
      },
      undefined,
      () => {
        if (!mountedRef.current) return;
        sceneRef.current = null;
        setScene(null);
      },
    );

    return () => {
      mountedRef.current = false;
      disposeObject3D(sceneRef.current);
      sceneRef.current = null;
    };
  }, [url]);

  if (!scene) return fallback;

  return <primitive object={scene} {...props} />;
}
