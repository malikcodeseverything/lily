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
uniform float uExplode;
uniform float uStyleFrom;
uniform float uStyleTo;
uniform float uStyleMix;

varying vec3 vColor;
varying float vEnergy;

#include <noise>

// Render styles: 0 natural, 1 hologram, 2 thermal, 3 ember.
vec3 thermal(float h) {
  vec3 c = mix(vec3(0.02, 0.0, 0.08), vec3(0.38, 0.0, 0.6), smoothstep(0.0, 0.25, h));
  c = mix(c, vec3(0.92, 0.08, 0.16), smoothstep(0.2, 0.45, h));
  c = mix(c, vec3(1.0, 0.55, 0.0), smoothstep(0.4, 0.65, h));
  c = mix(c, vec3(1.0, 0.95, 0.45), smoothstep(0.62, 0.85, h));
  return mix(c, vec3(1.0), smoothstep(0.85, 1.0, h));
}

vec3 styled(float style, vec3 shaded, vec3 col, float fres, vec3 world, float energy, float r) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  if (style < 0.5) return shaded;
  if (style < 1.5) {
    float scan = 0.72 + 0.28 * sin(world.y * 95.0 - uTime * 5.0);
    float flicker = 0.92 + 0.08 * sin(uTime * 31.0 + r * 50.0);
    return vec3(0.22, 0.82, 1.0) * (0.22 + lum * 0.95 + fres * 0.9) * scan * flicker;
  }
  if (style < 2.5) {
    float heat = clamp(lum * 0.85 + fres * 0.3 + energy * 0.35 + 0.06 * sin(world.y * 4.0 + uTime), 0.0, 1.0);
    return thermal(heat);
  }
  float flick = 0.78 + 0.22 * sin(uTime * 7.0 + r * 30.0);
  return vec3(1.0, 0.42, 0.1) * (0.25 + lum * 1.25) * flick + vec3(1.0, 0.82, 0.45) * fres * 0.45;
}

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
      p.y += w * beat * 0.14;
      p.x -= w * w * (0.5 + 0.5 * beat) * 0.12;
    } else if (a > 0.0) {
      p.x += sin(uTime * 1.6 - a * 9.0) * 0.07 * a;
      p.z += cos(uTime * 1.3 - a * 7.0) * 0.05 * a;
    }
    p.y += 0.015 * sin(uTime * 1.7 + 1.2);
  } else if (type < 4.5) {
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
  } else if (type < 5.5) {
    // Jet: afterburner flicker, then a slow roll and bob for the airframe.
    if (a >= 1.0) {
      float d = a - 1.0;
      float flick = 0.5 + 0.5 * sin(uTime * 37.0 + r * 40.0) * sin(uTime * 23.0 + r * 13.0);
      p.x -= d * (0.06 + 0.08 * flick);
      p.yz *= 1.0 + 0.15 * flick * d;
    }
    float roll = 0.08 * sin(uTime * 0.7);
    float c = cos(roll);
    float s = sin(roll);
    p.yz = mat2(c, s, -s, c) * p.yz;
    n.yz = mat2(c, s, -s, c) * n.yz;
    p.y += 0.025 * sin(uTime * 1.1);
  } else if (type < 6.5) {
    // Orbit: Keplerian-ish angular speed, slower farther out.
    float speed = a > 0.0 ? 0.55 / pow(max(a, 0.15), 1.5) : 0.25;
    float ang = uTime * min(speed, 2.2) * 0.35;
    p = rotY(p, ang);
    n = rotY(n, ang);
  } else {
    // Swim: a travelling wave that grows toward the tail, fins flutter.
    if (a <= 1.0) {
      float w = pow(a, 1.6);
      p.z += sin(uTime * 3.2 - a * 5.5) * 0.16 * w;
      p.x += cos(uTime * 3.2 - a * 5.5) * 0.02 * w;
    } else {
      float f = a - 2.0;
      p.y += sin(uTime * 6.0 + r * 3.0) * 0.03 * f;
      p.z += sin(uTime * 3.2 - 0.5 * 5.5) * 0.04;
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
  // Negative size marks one-sided points (e.g. the two faces of a wing).
  float sizeA = metaA.x;
  float sizeB = metaB.x;
  float oneSided = e < 0.5 ? step(sizeA, 0.0) : step(sizeB, 0.0);
  float size = mix(abs(sizeA), abs(sizeB), e);
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
    // A swirling ball of light that keeps each particle's own color.
    vec3 core = dir * (0.12 + 0.2 * pow(rnd.x, 0.3));
    core = rotY(core, uTime * (1.5 + rnd.z * 3.5));
    core += 0.03 * vec3(snoise(core * 6.0 + uTime), snoise(core * 6.0 + 9.0 + uTime), snoise(core * 6.0 + 19.0));
    float ce = c * c * (3.0 - 2.0 * c);
    float stag = clamp(ce * 1.5 - rnd.w * 0.5, 0.0, 1.0);
    p = mix(p, core, stag);
  }

  // Two-palm stretch: the object blows apart as the hands separate.
  float ex = uExplode;
  if (ex > 1e-4) {
    vec3 dir = normalize(p + (rnd.yzw - 0.5) * 0.9 + 1e-4);
    vec3 q = p * 1.5 + rnd.yzw * 2.0 + vec3(0.0, uTime * 0.3, 0.0);
    vec3 drift = vec3(snoise(q), snoise(q + 5.2), snoise(q + 9.7));
    p += (dir * (0.15 + rnd.x * 0.75) + drift * 0.28) * ex;
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
      world.xy += d / (sqrt(r2) + 1e-3) * fall * f.w * uFingerRadius * 0.75;
      world.z += fall * f.w * 0.2 * (rnd.x - 0.35);
      touch += fall * f.w;
    }
  }

  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;

  // Two-sided wrapped lighting plus a soft rim, in view space.
  // Unlit points (plumes, stars, scans) have a zero normal; normalizing it
  // yields NaN on some GPUs, which would turn the point black.
  bool lighted = hasN > 0.5 && dot(n, n) > 1e-6;
  vec3 nv = lighted ? normalize(normalMatrix * n) : vec3(0.0, 0.0, 1.0);
  float ndl = abs(dot(nv, uLightDir));
  float rim = lighted ? pow(1.0 - abs(nv.z), 2.0) : 0.0;
  float lit = lighted ? 0.4 + 0.75 * ndl + 0.32 * rim : 1.0;
  float energy = clamp(max(max(mid * uScatter, c * 0.8), ex * 0.7) + touch * 0.6, 0.0, 1.0);

  vec3 shaded = col * lit + col * glow * 0.55;
  // Hot, but saturated: brighten toward the particle's own hue, not white.
  shaded = mix(shaded, col * 1.35 + col * col * 0.4, energy * 0.7);
  float fres = lighted ? rim : 0.45;
  vec3 sA = styled(uStyleFrom, shaded, col, fres, world.xyz, energy, rnd.x);
  vec3 sB = styled(uStyleTo, shaded, col, fres, world.xyz, energy, rnd.x);
  vColor = mix(sA, sB, uStyleMix);
  vEnergy = energy;

  float s = uPointSize * size * uObjectScale;
  s *= 1.0 - 0.35 * mid * uScatter;
  s *= 1.0 - 0.4 * c;
  if (uHalo > 0.5) {
    float keep = step(rnd.w, uHaloFraction * (1.0 + glow) + mid * uScatter * 0.12);
    s *= 1.0 - 0.5 * c;
    s *= uHaloSize * keep;
  }
  // Hide one-sided points that face away from the camera (only at rest,
  // mid-morph everything is visible so the cloud does not flicker).
  vec3 toCam = normalize(-mv.xyz);
  if (lighted && oneSided > 0.5 && dot(nv, toCam) < -0.02 && mid < 0.05 && c < 0.05) s = 0.0;
  float px = s * projectionMatrix[1][1] * uViewportHeight * 0.5 / -mv.z;
  gl_PointSize = uHalo > 0.5 || s <= 0.0 ? px : max(px, 1.25);
}
