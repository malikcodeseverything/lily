// Minimal stroke icons (24px grid, 1.6 stroke), inlined to stay offline-friendly.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  camera: svg('<path d="M15 10.5 20 7v10l-5-3.5"/><rect x="3" y="6" width="12" height="12" rx="2.5"/>'),
  cameraOff: svg('<path d="M15 10.5 20 7v10l-5-3.5"/><rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="M2 3l20 18"/>'),
  record: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>'),
  upload: svg('<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M8 12.5 6.6 11a1.6 1.6 0 0 0-2.3 2.2l3.4 4.1A6 6 0 0 0 12.3 20H13a5 5 0 0 0 5-5v-3.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
};
