uniform float uHalo;
uniform float uHaloStrength;
uniform float uOpacity;

varying vec3 vColor;
varying float vEnergy;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  if (uHalo > 0.5) {
    // Additive soft glow sprite.
    float a = exp(-d * d * 4.5) * uHaloStrength * (0.6 + 0.6 * vEnergy) * uOpacity;
    gl_FragColor = vec4(vColor, a);
  } else {
    // Opaque round point with a hint of spherical shading.
    if (d > 0.92) discard;
    gl_FragColor = vec4(vColor * (1.0 - 0.2 * d * d) * uOpacity, 1.0);
  }
}
