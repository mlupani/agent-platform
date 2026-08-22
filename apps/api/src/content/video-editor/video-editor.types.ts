export type OverlayVerticalPosition = 'top' | 'center' | 'bottom';

export type LogoCornerPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type AutoEditStatus =
  | 'NONE'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED';

export type ContentAssetRole = 'ORIGINAL' | 'EDITED';

export interface VideoEditingInstructions {
  addHook: boolean;
  hookText: string;
  hookStart: number;
  hookEnd: number;
  hookPosition: OverlayVerticalPosition;
  hookFontSize?: number;
  addCta: boolean;
  ctaText: string;
  ctaStart: number;
  ctaEnd: number;
  ctaPosition: OverlayVerticalPosition;
  ctaFontSize?: number;
  addLogo: boolean;
  logoPosition: LogoCornerPosition;
  logoWidth?: number;
  logoOpacity?: number;
}

export interface VideoEditorBranding {
  logoUrl?: string | null;
  primaryColor?: string | null;
}

export type VideoEditOperation =
  | {
      type: 'resize';
      width: number;
      height: number;
    }
  | {
      type: 'bars';
    }
  | {
      type: 'text';
      id: 'hook' | 'cta';
      text: string;
      start: number;
      end: number;
      position: OverlayVerticalPosition;
      fontSize: number;
    }
  | {
      type: 'logo';
      filePath: string;
      position: LogoCornerPosition;
      width: number;
      opacity: number;
    };

export interface VideoProbe {
  path: string;
  width: number;
  height: number;
  durationSeconds: number;
  codecName?: string;
  formatName?: string;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface AutoEditInput {
  videoBuffer: Buffer;
  mimeType?: string;
  instructions: VideoEditingInstructions;
  branding: VideoEditorBranding;
  expectedDurationSeconds?: number;
}

export interface AutoEditResult {
  skipped: boolean;
  buffer?: Buffer;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
  operations: VideoEditOperation['type'][];
}

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
}

export interface FfmpegRunner {
  run(args: string[], timeoutMs: number): Promise<FfmpegRunResult>;
  probe(args: string[], timeoutMs: number): Promise<FfmpegRunResult>;
  ffmpegPath(): string;
  ffprobePath(): string;
}
