import * as THREE from 'three';

const ray = new THREE.Vector3();

/**
 * Map a viewport position (u, v in 0..1, origin top-left) onto the
 * plane z = planeZ in world space.
 */
export function viewportToPlane(
  camera: THREE.PerspectiveCamera,
  u: number,
  v: number,
  planeZ: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  ray.set(u * 2 - 1, -(v * 2 - 1), 0.5).unproject(camera).sub(camera.position).normalize();
  const t = (planeZ - camera.position.z) / ray.z;
  return out.copy(camera.position).addScaledVector(ray, t);
}

/** World position to viewport (u, v in 0..1, origin top-left). */
export function worldToViewport(camera: THREE.PerspectiveCamera, p: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
  ray.copy(p).project(camera);
  return out.set((ray.x + 1) / 2, (1 - ray.y) / 2);
}
