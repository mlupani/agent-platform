import { SEED_INDUSTRIES, type SeedIndustry } from './types';

const DEFAULT_INDUSTRY: SeedIndustry = 'estetica';

function printHelp(): void {
  console.log(`Seed por rubro.

Uso:
  pnpm db:seed -- --estetica
  pnpm db:seed -- --peluqueria
  pnpm db:seed -- --inmobiliaria
  pnpm db:seed -- --clinica-dental
  pnpm db:seed -- --salon-de-eventos

También:
  pnpm db:seed -- --industry=peluqueria
  pnpm docker:seed -- --peluqueria

Sin flag usa "${DEFAULT_INDUSTRY}" (compatibilidad).
`);
}

function isIndustry(value: string): value is SeedIndustry {
  return (SEED_INDUSTRIES as readonly string[]).includes(value);
}

export function parseIndustry(argv: string[]): SeedIndustry {
  const args = argv.slice(2).filter((arg) => arg !== '--');

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const selected: string[] = [];

  for (const industry of SEED_INDUSTRIES) {
    if (args.includes(`--${industry}`) || args.includes(industry)) {
      selected.push(industry);
    }
  }

  for (const arg of args) {
    if (arg.startsWith('--industry=')) {
      selected.push(arg.slice('--industry='.length));
    }
  }

  const industryFlag = args.indexOf('--industry');
  if (industryFlag >= 0 && args[industryFlag + 1]) {
    selected.push(args[industryFlag + 1]);
  }

  const unique = [...new Set(selected)];

  if (unique.length > 1) {
    console.error(
      `Pasá un solo rubro. Recibí: ${unique.map((item) => `--${item}`).join(', ')}`,
    );
    printHelp();
    process.exit(1);
  }

  if (unique.length === 1) {
    const value = unique[0];
    if (!isIndustry(value)) {
      console.error(`Rubro desconocido: ${value}`);
      printHelp();
      process.exit(1);
    }
    return value;
  }

  const unknownFlags = args.filter((arg) => {
    if (!arg.startsWith('--')) return false;
    if (arg === '--help' || arg === '-h' || arg === '--industry') return false;
    if (arg.startsWith('--industry=')) return false;
    return !SEED_INDUSTRIES.some((industry) => arg === `--${industry}`);
  });

  if (unknownFlags.length > 0) {
    console.error(`Flag desconocido: ${unknownFlags[0]}`);
    printHelp();
    process.exit(1);
  }

  console.log(`Sin rubro: uso --${DEFAULT_INDUSTRY} por defecto.`);
  return DEFAULT_INDUSTRY;
}
