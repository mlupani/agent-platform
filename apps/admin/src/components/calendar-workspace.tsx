'use client';

import { useState } from 'react';
import { AppointmentRemindersForm } from '@/components/appointment-reminders-form';
import { AppointmentsCalendar } from '@/components/appointments-calendar';
import { ClassSchedulePanel } from '@/components/class-schedule-panel';

type Tab = 'calendar' | 'schedule' | 'reminders';

const TABS = [
  ['calendar', 'Calendario'],
  ['schedule', 'Horarios de clase'],
  ['reminders', 'Recordatorios'],
] as const;

export function CalendarWorkspace() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [openedReminders, setOpenedReminders] = useState(false);
  const [openedSchedule, setOpenedSchedule] = useState(false);
  if (tab === 'reminders' && !openedReminders) {
    setOpenedReminders(true);
  }
  if (tab === 'schedule' && !openedSchedule) {
    setOpenedSchedule(true);
  }

  return (
    <div className="space-y-6">
      <nav
        className="flex flex-wrap gap-1 border-b border-line"
        aria-label="Secciones de calendario"
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px min-h-11 cursor-pointer ${
              tab === id
                ? 'border-accent text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div hidden={tab !== 'calendar'}>
        <AppointmentsCalendar />
      </div>
      {openedSchedule ? (
        <div hidden={tab !== 'schedule'}>
          <ClassSchedulePanel />
        </div>
      ) : null}
      {openedReminders ? (
        <div hidden={tab !== 'reminders'}>
          <AppointmentRemindersForm />
        </div>
      ) : null}
    </div>
  );
}
