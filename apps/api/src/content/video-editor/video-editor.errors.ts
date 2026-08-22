export class VideoEditError extends Error {
  readonly code: string;

  constructor(message: string, code = 'VIDEO_EDIT_FAILED') {
    super(message);
    this.name = 'VideoEditError';
    this.code = code;
  }
}

export class VideoEditUnavailableError extends VideoEditError {
  constructor(message: string) {
    super(message, 'VIDEO_EDIT_UNAVAILABLE');
    this.name = 'VideoEditUnavailableError';
  }
}

export class VideoProbeError extends VideoEditError {
  constructor(message: string) {
    super(message, 'VIDEO_PROBE_FAILED');
    this.name = 'VideoProbeError';
  }
}
