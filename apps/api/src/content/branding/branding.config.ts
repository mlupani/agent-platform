import { ConfigService } from '@nestjs/config';

export type LogoPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface BrandingConfig {
  enabled: boolean;
  logo: {
    enabled: boolean;
    position: LogoPosition;
    widthPercent: number;
    marginPercent: number;
  };
  text: {
    enabled: boolean;
    position: LogoPosition;
    widthPercent: number;
    marginPercent: number;
  };
}

const VALID_POSITIONS: Set<string> = new Set([
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]);

function envBool(
  config: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const raw = config.get<string>(key);
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envFloat(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string>(key);
  const parsed = raw != null && raw !== '' ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadBrandingConfig(config: ConfigService): BrandingConfig {
  const positionRaw = config
    .get<string>('BRANDING_LOGO_POSITION')
    ?.trim()
    .toLowerCase() as LogoPosition | undefined;

  const widthPercentRaw = envFloat(
    config,
    'BRANDING_LOGO_WIDTH_PERCENT',
    12,
  );
  const marginPercentRaw = envFloat(
    config,
    'BRANDING_LOGO_MARGIN_PERCENT',
    3,
  );

  const widthPercent = Math.min(40, Math.max(5, widthPercentRaw));
  const marginPercent = Math.min(10, Math.max(0, marginPercentRaw));

  const position: LogoPosition =
    positionRaw && VALID_POSITIONS.has(positionRaw)
      ? positionRaw
      : 'bottom-right';

  const textPositionRaw = config
    .get<string>('BRANDING_TEXT_POSITION')
    ?.trim()
    .toLowerCase() as LogoPosition | undefined;
  const textWidthPercent = Math.min(95, Math.max(50, envFloat(config, 'BRANDING_TEXT_WIDTH_PERCENT', 85)));
  const textMarginPercent = Math.min(10, Math.max(0, envFloat(config, 'BRANDING_TEXT_MARGIN_PERCENT', 4)));
  const textPosition: LogoPosition =
    textPositionRaw && VALID_POSITIONS.has(textPositionRaw) ? textPositionRaw : 'center';

  return {
    enabled: envBool(config, 'BRANDING_ENABLED', true),
    logo: {
      enabled: envBool(config, 'BRANDING_LOGO_ENABLED', true),
      position,
      widthPercent,
      marginPercent,
    },
    text: {
      enabled: envBool(config, 'BRANDING_TEXT_ENABLED', false),
      position: textPosition,
      widthPercent: textWidthPercent,
      marginPercent: textMarginPercent,
    },
  };
}
