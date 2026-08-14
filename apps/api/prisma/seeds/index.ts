import { clinicaDentalSeed } from './industries/clinica-dental';
import { esteticaSeed } from './industries/estetica';
import { inmobiliariaSeed } from './industries/inmobiliaria';
import { peluqueriaSeed } from './industries/peluqueria';
import { salonDeEventosSeed } from './industries/salon-de-eventos';
import type { IndustrySeed, SeedIndustry } from './types';

export const industrySeeds: Record<SeedIndustry, IndustrySeed> = {
  estetica: esteticaSeed,
  peluqueria: peluqueriaSeed,
  inmobiliaria: inmobiliariaSeed,
  'clinica-dental': clinicaDentalSeed,
  'salon-de-eventos': salonDeEventosSeed,
};

export { parseIndustry } from './parse-industry';
export { SEED_INDUSTRIES, type SeedIndustry } from './types';
