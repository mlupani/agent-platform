/**
 * SigueFit → plataforma: reconciliación semanal mientras corren los dos
 * sistemas en paralelo. SigueFit es la verdad; esto es el espejo.
 *
 *   tsx prisma/siguefit-sync.ts --file export.csv            (dry run)
 *   tsx prisma/siguefit-sync.ts --file export.csv --commit   (escribe)
 *
 * Ver prisma/README-siguefit-sync.md para el detalle.
 *
 * La lógica pura vive en ../src/siguefit/*.ts y está cubierta por tests.
 * Este archivo es solo el pegamento CLI + Prisma (sin test, igual que seed.ts).
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';

import { parseDelimited, toRecords } from '../src/siguefit/csv';
import { parseTurnoRows } from '../src/siguefit/parse';
import { matchStudents } from '../src/siguefit/match';
import {
  latestProgressByStudent,
  buildDesiredSlots,
  type ResolvedRow,
} from '../src/siguefit/resolve';
import {
  planBalances,
  planRoster,
  formatSlot,
  type RosterTemplate,
} from '../src/siguefit/reconcile';

config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

interface Args {
  file: string;
  weeks: number;
  commit: boolean;
  crearFaltantes: boolean;
  force: boolean;
  tz?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    file: '',
    weeks: 2,
    commit: false,
    crearFaltantes: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--weeks') args.weeks = Math.max(1, Number(argv[++i]) || 2);
    else if (a === '--commit') args.commit = true;
    else if (a === '--crear-faltantes') args.crearFaltantes = true;
    else if (a === '--force') args.force = true;
    else if (a === '--tz') args.tz = argv[++i];
  }
  return args;
}

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

const h = (s: string) => `\n\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;
const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(
      'Falta --file <export.csv>. Ver prisma/README-siguefit-sync.md',
    );
    process.exit(1);
  }
  if (/\.xlsx?$/i.test(args.file)) {
    console.error(
      'Es un Excel. Abrilo y "Guardar como" → CSV, después pasame el .csv.',
    );
    process.exit(1);
  }

  const business = await prisma.business.findFirst({
    orderBy: { createdAt: 'asc' },
  });
  if (!business) {
    console.error('No hay un negocio configurado.');
    process.exit(1);
  }
  const businessId = business.id;
  const timezone =
    args.tz || business.timezone || 'America/Argentina/Buenos_Aires';

  const text = stripBom(
    readFileSync(resolve(process.cwd(), args.file), 'utf8'),
  );
  const { rows, issues: parseIssues } = parseTurnoRows(
    toRecords(parseDelimited(text)),
  );
  if (rows.length === 0) {
    console.error(
      'No encontré turnos en el archivo. ¿Es el export de la lista de turnos?',
    );
    process.exit(1);
  }

  const rawNames = [...new Set(rows.map((r) => r.rawName))];
  const users = await prisma.user.findMany({
    where: { businessId },
    select: { id: true, name: true, phone: true, email: true },
  });
  const { matched, unmatched } = matchStudents(rawNames, users);

  // --crear-faltantes: sólo para nombres sin ningún candidato parecido.
  const created: string[] = [];
  if (args.crearFaltantes) {
    for (const miss of unmatched) {
      if (miss.candidates && miss.candidates.length > 0) continue;
      if (!args.commit) {
        created.push(miss.rawName);
        continue;
      }
      const u = await prisma.user.create({
        data: {
          businessId,
          name: miss.rawName,
          metadata: { origin: 'siguefit-sync' },
        },
        select: { id: true, name: true, phone: true, email: true },
      });
      users.push(u);
      matched.set(miss.rawName, u.id);
      created.push(miss.rawName);
    }
  }

  const userById = new Map(users.map((u) => [u.id, u]));
  const resolvedRows: ResolvedRow[] = rows
    .map((row) => {
      const userId = matched.get(row.rawName);
      if (!userId) return null;
      return { userId, name: userById.get(userId)?.name || row.rawName, row };
    })
    .filter((r): r is ResolvedRow => r !== null);

  // ---- Balances ----------------------------------------------------------
  const services = (
    await prisma.service.findMany({
      where: { businessId },
      select: { id: true, sessionCount: true },
    })
  ).filter((s) => s.sessionCount > 1);

  const passes = (
    await prisma.servicePass.findMany({
      where: { businessId },
      select: {
        id: true,
        userId: true,
        serviceId: true,
        sessionCount: true,
        sessionsPaid: true,
        sessionsUsed: true,
        status: true,
        createdAt: true,
      },
    })
  ).map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }));

  const students = latestProgressByStudent(resolvedRows);
  const balance = planBalances({ students, passes, services });

  // ---- Roster -----------------------------------------------------------
  const now = new Date();
  const rangeEnd = DateTime.fromJSDate(now)
    .plus({ weeks: args.weeks })
    .toJSDate();

  const templates: RosterTemplate[] = (
    await prisma.classTemplate.findMany({
      where: { businessId },
      include: {
        service: { select: { durationMinutes: true, capacity: true } },
      },
    })
  ).map((t) => ({
    dayOfWeek: t.dayOfWeek,
    startTime: t.startTime,
    serviceId: t.serviceId,
    durationMinutes: t.service.durationMinutes,
    capacity: Math.max(1, t.capacity ?? t.service.capacity ?? 1),
  }));

  const current = (
    await prisma.appointment.findMany({
      where: { businessId, startsAt: { gte: now, lt: rangeEnd } },
      select: { id: true, userId: true, startsAt: true, status: true },
    })
  ).map((a) => ({ ...a, startsAtUTC: a.startsAt.toISOString() }));

  const desired = buildDesiredSlots(resolvedRows, timezone).filter(
    (s) => new Date(s.startsAtUTC) < rangeEnd,
  );

  const roster = planRoster({
    desired,
    current,
    templates,
    timezone,
    now: now.toISOString(),
  });

  // ---- Reporte --------------------------------------------------------
  console.log(
    h('SigueFit sync') +
      dim(
        `  ${args.commit ? 'COMMIT' : 'dry run'} · tz ${timezone} · ${args.weeks} sem`,
      ),
  );
  console.log(
    `Turnos leídos: ${rows.length} · alumnas distintas: ${rawNames.length} · con match: ${matched.size}`,
  );

  if (parseIssues.length) {
    console.log(h('Filas ilegibles'));
    parseIssues.forEach((i) => console.log('  ' + warn(i)));
  }

  if (unmatched.length) {
    console.log(h(`Sin match (${unmatched.length}) — no se tocan`));
    for (const m of unmatched) {
      const hint = m.candidates?.length
        ? dim(`  ¿= ${m.candidates.join(' / ')}?`)
        : dim('  (sin parecido)');
      console.log(`  ${warn(m.rawName)}${hint}`);
    }
  }
  if (created.length) {
    console.log(
      h(
        `Alumnas nuevas ${args.commit ? 'creadas' : 'a crear'} (${created.length})`,
      ),
    );
    created.forEach((n) => console.log('  ' + n));
  }

  console.log(h('Saldos'));
  const byKind = (k: string) => balance.actions.filter((a) => a.kind === k);
  console.log(
    `  crear ${byKind('create').length} · ajustar ${byKind('update').length} · cerrar packs viejos ${byKind('retire').length}`,
  );
  for (const a of balance.actions) {
    if (a.kind === 'create')
      console.log(
        `  + ${a.name}: pack ${a.sessionCount}, usadas ${a.sessionsUsed}`,
      );
    else if (a.kind === 'update')
      console.log(
        `  ~ ${a.name}: pack ${a.sessionCount}, usadas ${a.prevUsed} → ${a.sessionsUsed}` +
          (Math.abs(a.sessionsUsed - a.prevUsed) > 2
            ? warn('  (salto grande, revisá)')
            : ''),
      );
    else console.log(dim(`  · ${a.name}: cierro pack viejo`));
  }
  balance.issues.forEach((i) => console.log('  ' + warn(i)));

  console.log(h('Grilla'));
  console.log(
    `  crear ${roster.toCreate.length} turnos · cancelar ${roster.toCancel.length}`,
  );
  for (const c of roster.toCreate)
    console.log(`  + ${formatSlot(c.startsAtUTC, timezone)}  ${c.name}`);
  for (const c of roster.toCancel) {
    const who = c.userId
      ? (userById.get(c.userId)?.name ?? c.userId)
      : '(sin alumna)';
    console.log(
      `  - ${formatSlot(c.startsAtUTC, timezone)}  ${who}  ${dim('ya no está en SigueFit')}`,
    );
  }
  roster.issues.forEach((i) => console.log('  ' + warn(i)));

  const cancelLimit = Math.max(5, Math.round(current.length * 0.3));
  const tooManyCancels = roster.toCancel.length > cancelLimit;
  if (tooManyCancels) {
    console.log(
      h(
        warn(
          `⚠ ${roster.toCancel.length} cancelaciones (límite ${cancelLimit}).`,
        ),
      ) +
        '\n  Suele significar que exportaste menos semanas de las que hay cargadas.' +
        `\n  Revisá la lista. Si está bien, corré con --force.`,
    );
  }

  if (!args.commit) {
    console.log(
      h(dim('Dry run. Nada se escribió. Agregá --commit para aplicar.')),
    );
    return;
  }
  if (tooManyCancels && !args.force) {
    console.log(h(warn('Abortado: demasiadas cancelaciones y sin --force.')));
    process.exit(1);
  }

  // ---- Escritura -----------------------------------------------------
  const today = DateTime.now().setZone(timezone).toISODate();
  let touched = 0;

  for (const a of balance.actions) {
    if (a.kind === 'create') {
      const pass = await prisma.servicePass.create({
        data: {
          businessId,
          userId: a.userId,
          serviceId: a.serviceId,
          sessionCount: a.sessionCount,
          sessionsPaid: a.sessionsPaid,
          sessionsUsed: a.sessionsUsed,
          status: a.status,
        },
      });
      await prisma.classCreditMovement.create({
        data: {
          businessId,
          userId: a.userId,
          servicePassId: pass.id,
          type: 'PURCHASE',
          amount: a.sessionsPaid,
          reason: `Saldo inicial SigueFit ${today}`,
        },
      });
      if (a.sessionsUsed > 0) {
        await prisma.classCreditMovement.create({
          data: {
            businessId,
            userId: a.userId,
            servicePassId: pass.id,
            type: 'MANUAL_ADJUSTMENT',
            amount: -a.sessionsUsed,
            reason: `Saldo inicial SigueFit ${today}`,
          },
        });
      }
      touched += 1;
    } else if (a.kind === 'update') {
      await prisma.servicePass.update({
        where: { id: a.passId },
        data: {
          serviceId: a.serviceId,
          sessionCount: a.sessionCount,
          sessionsPaid: a.sessionsPaid,
          sessionsUsed: a.sessionsUsed,
          status: a.status,
        },
      });
      if (a.sessionsUsed !== a.prevUsed) {
        await prisma.classCreditMovement.create({
          data: {
            businessId,
            userId: a.userId,
            servicePassId: a.passId,
            type: 'MANUAL_ADJUSTMENT',
            amount: a.prevUsed - a.sessionsUsed,
            reason: `Sync SigueFit ${today}`,
          },
        });
      }
      touched += 1;
    } else {
      const pass = passes.find((p) => p.id === a.passId);
      await prisma.servicePass.update({
        where: { id: a.passId },
        data: {
          status: 'COMPLETED',
          sessionsUsed: pass?.sessionsPaid ?? undefined,
        },
      });
      touched += 1;
    }
  }

  for (const c of roster.toCreate) {
    const u = userById.get(c.userId);
    await prisma.appointment.create({
      data: {
        businessId,
        serviceId: c.serviceId,
        userId: c.userId,
        contactName: u?.name ?? null,
        contactPhone: u?.phone ?? null,
        contactEmail: u?.email ?? null,
        startsAt: new Date(c.startsAtUTC),
        endsAt: new Date(c.endsAtUTC),
        timezone,
        status: 'confirmed',
        notes: 'Alta desde SigueFit sync',
      },
    });
    touched += 1;
  }

  for (const c of roster.toCancel) {
    await prisma.appointment.update({
      where: { id: c.appointmentId },
      data: { status: 'cancelled', notes: 'Cancelada: ya no está en SigueFit' },
    });
    touched += 1;
  }

  console.log(h(ok(`Listo. ${touched} cambios aplicados.`)));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
