// Two shape "slots" live in the same geometry. uMorph blends A -> B with a
// per-particle stagger, scattering points through noise on the way.
attribute vec3 posB;
attribute vec3 colA;
attribute vec3 colB;
attribute vec3 nrmA;
attribute vec3 nrmB;
attribute vec2 metaA; // size, anim
attribute vec2 metaB;
attribute vec4 rnd;

uniform float uTime;
uniform float uMorph;
uniform float uScatter;
uniform float uCollapse;
uniform float uAnimA;
uniform float uAnimB;
uniform mat3 uPoseA;
uniform mat3 uPoseB;
uniform float uGlowA;
uniform float uGlowB;
uniform float uPointSize;
uniform float uObjectScale;
uniform float uViewportHeight;
uniform vec4 uFingers[2];
uniform float uFingerRadius;
uniform vec3 uLightDir;
uniform float uHalo;
uniform float uHaloSize;
uniform float uHaloFraction;

varying vec3 vColor;
varying float vEnergy;

#include <noise>

vec3 rotY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void animatePoint(inout vec3 p, inout vec3 n, float a, float type, float r) {
  if (type < 0.5) return;
  if (type < 1.5) {
    // Flap: rotate each wing about the body (y) axis.
    float beat = sin(uTime * 6.5);
    p.y += 0.02 * beat;
    if (abs(a) > 0.5) {
      float side = sign(a);
      float phi = -0.25 + 1.0 * (0.5 + 0.5 * beat);
      float c = cos(phi);
      float s = sin(phi);
      float u = abs(p.x);
      float nu = u * c - p.z * s;
      p.z = u * s + p.z * c;
      p.x = side * nu;
      float un = n.x * side;
      float nnu = un * c - n.z * s;
      n.z = un * s + n.z * c;
      n.x = side * nnu;
    }
  } else if (type < 2.5) {
    // Sway: plants bend more toward the top.
    float h = a * a;
    p.x += sin(uTime * 1.1 + p.y * 1.5) * 0.05 * h;
    p.z += cos(uTime * 0.85 + p.y * 1.2) * 0.035 * h;
  } else if (type < 3.5) {
    // Dragon: slow wing beat and a lazy tail.
    float beat = sin(uTime * 1.7);
    if (abs(a) >= 1.0) {
      float w = abs(a) - 1.0;
      p.y += w * beat * 0.13;
      p.z += w * w * (0.5 + 0.5 * beat) * 0.1;
    } else if (a > 0.0) {
      p.x += sin(uTime * 1.6 - a * 9.0) * 0.07 * a;
      p.z += cos(uTime * 1.3 - a * 7.0) * 0.05 * a;
    }
    p.y += 0.015 * sin(uTime * 1.7 + 1.2);
  } else {
    // Pulse: jellyfish bell contracts, tentacles trail.
    float pulse = 0.5 + 0.5 * sin(uTime * 1.8);
    p.y += 0.06 * sin(uTime * 1.8 - 0.8);
    if (a <= 1.0) {
      p.xz *= 1.0 - 0.13 * pulse * a;
      p.y += 0.05 * pulse * a;
    } else {
      float t = a - 1.0;
      p.x += sin(uTime * 1.4 - t * 7.0 + r * 6.28) * 0.08 * t;
      p.z += cos(uTime * 1.1 - t * 6.0 + r * 6.28) * 0.08 * t;
      p.y += 0.04 * pulse * (1.0 - t);
    }
  }
}

void main() {
  vec3 pA = position;
  vec3 nA = nrmA;
  animatePoint(pA, nA, metaA.y, uAnimA, rnd.x);
  pA = uPoseA * pA;
  nA = uPoseA * nA;

  vec3 pB = posB;
  vec3 nB = nrmB;
  animatePoint(pB, nB, metaB.y, uAnimB, rnd.x);
  pB = uPoseB * pB;
  nB = uPoseB * nB;

  // Staggered per-particle progress so the morph ripples through the cloud.
  float delay = rnd.x * 0.4;
  float lt = clamp((uMorph - delay) / 0.6, 0.0, 1.0);
  float e = lt * lt * (3.0 - 2.0 * lt);
  float mid = sin(3.14159265 * lt);

  vec3 p = mix(pA, pB, e);
  vec3 col = mix(colA, colB, e);
  float hasN = mix(step(0.1, length(nrmA)), step(0.1, length(nrmB)), e);
  vec3 n = mix(nA, nB, e);
  n = n / max(length(n), 1e-4);
  float size = mix(metaA.x, metaB.x, e);
  float glow = mix(uGlowA, uGlowB, e);

  // Dissolve: drift through a noise field and spiral outward mid-flight.
  float sc = uScatter * mid;
  if (sc > 1e-4) {
    vec3 q = p * 1.2 + rnd.yzw * 3.0 + vec3(0.0, uTime * 0.2, 0.0);
    vec3 drift = vec3(snoise(q), snoise(q + 17.1), snoise(q + 31.7));
    vec3 outward = normalize(p + (rnd.yzw - 0.5) * 0.8 + 1e-4);
    p += (drift * 0.8 + outward * 0.6) * sc * (0.55 + rnd.w * 0.9);
    p = rotY(p, sc * (rnd.y - 0.5) * 3.0);
  }

  // Collapse: everything gets pulled into a dense, spinning core.
  float c = uCollapse;
  if (c > 1e-4) {
    vec3 dir = normalize(rnd.yzw - 0.5 + 1e-4);
    vec3 core = dir * pow(rnd.x, 0.4) * 0.26;
    core = rotY(core, uTime * (1.5 + rnd.z * 3.5));
    core += 0.03 * vec3(snoise(core * 6.0 + uTime), snoise(core * 6.0 + 9.0 + uTime), snoise(core * 6.0 + 19.0));
    float ce = c * c * (3.0 - 2.0 * c);
    float stag = clamp(ce * 1.5 - rnd.w * 0.5, 0.0, 1.0);
    p = mix(p, core, stag);
  }

  vec4 world = modelMatrix * vec4(p, 1.0);

  // Fingertips push particles away in screen-aligned space.
  float touch = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 f = uFingers[i];
    if (f.w > 1e-3) {
      vec2 d = world.xy - f.xy;
      float r2 = dot(d, d);
      float fall = exp(-r2 / (uFingerRadius * uFingerRadius));
      world.xy += d / (sqrt(r2) + 1e-3) * fall * f.w * uFingerRadius * 0.9;
      world.z += fall * f.w * 0.2 * (rnd.x - 0.35);
      touch += fall * f.w;
    }
  }

  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;

  // Two-sided wrapped lighting plus a soft rim, in view space.
  vec3 nv = normalize(normalMatrix * n);
  float ndl = abs(dot(nv, uLightDir));
  float rim = pow(1.0 - abs(nv.z), 2.0);
  float lit = mix(1.0, 0.4 + 0.75 * ndl + 0.32 * rim, hasN);
  float energy = clamp(max(mid * uScatter, c * 0.9) + touch * 0.6, 0.0, 1.0);

  vec3 shaded = col * lit + col * glow * 0.55;
  shaded = mix(shaded, shaded * 1.5 + col * 0.35 + 0.04, energy * 0.75);
  vColor = shaded;
  vEnergy = energy;

  float s = uPointSize * size * uObjectScale;
  s *= 1.0 - 0.35 * mid * uScatter;
  s *= 1.0 - 0.3 * c;
  if (uHalo > 0.5) {
    float keep = step(rnd.w, uHaloFraction * (1.0 + glow) + energy * 0.2);
    s *= uHaloSize * keep;
  }
  float px = s * projectionMatrix[1][1] * uViewportHeight * 0.5 / -mv.z;
  gl_PointSize = uHalo > 0.5 ? px : max(px, 1.25);
}
