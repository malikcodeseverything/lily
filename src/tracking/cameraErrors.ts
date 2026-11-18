/** A camera/model failure translated into something a person can act on. */
export interface CameraProblem {
  title: string;
  steps: string[];
  /** Raw error name for the console and bug reports. */
  code: string;
}

const isMac = () => /Mac/i.test(navigator.platform || navigator.userAgent);
const isWindows = () => /Win/i.test(navigator.platform || navigator.userAgent);

export function describeCameraError(err: unknown, phase: 'camera' | 'model'): CameraProblem {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  const code = `${name}: ${message}`;

  if (phase === 'model') {
    return {
      title: 'Your camera works, but the hand model could not download.',
      steps: [
        'Check your internet connection and any ad or content blocker (the model loads from storage.googleapis.com).',
        'Or run "npm run fetch-models" once to keep a local copy, then reload.',
      ],
      code,
    };
  }

  if (name === 'InsecureContext') {
    const local = `http://localhost:${location.port || '5173'}`;
    return {
      title: 'Browsers only allow the camera on localhost or HTTPS.',
      steps: [
        `On this computer, open ${local} instead of the Network (192.168...) address.`,
        'To try it on a phone, run "npm run dev:https" and open the https Network address it prints (accept the certificate warning once).',
      ],
      code,
    };
  }

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const os = isWindows()
      ? 'Windows: Settings › Privacy & security › Camera › turn on "Camera access" and "Let desktop apps access your camera".'
      : isMac()
        ? 'macOS: System Settings › Privacy & Security › Camera › turn on your browser, then restart the browser.'
        : 'Check your operating system privacy settings for camera access.';
    return {
      title: 'Camera permission is blocked.',
      steps: ['Click the camera icon at the right of the address bar, choose Allow, and reload the page.', os],
      code,
    };
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return {
      title: 'No camera was found.',
      steps: ['Plug in or enable a webcam, then try again.', 'If you use an external camera, check that it is selected in your browser site settings.'],
      code,
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return {
      title: 'The camera is busy or blocked by your system.',
      steps: [
        'Close other apps or tabs that may be using it (Zoom, Teams, Discord, OBS, FaceTime, another browser tab).',
        isWindows()
          ? 'Also check Windows Settings › Privacy & security › Camera, and any laptop camera kill switch or F-key.'
          : 'Also check your system privacy settings for camera access.',
      ],
      code,
    };
  }

  return {
    title: 'The camera could not start.',
    steps: ['Reload the page and try again.', 'If it keeps failing, open the browser console and share the error shown below.'],
    code,
  };
}
