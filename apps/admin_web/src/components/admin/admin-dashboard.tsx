'use client';

import { useMemo, useState } from 'react';

import { AppShell } from '../app-shell';
import { useAuth } from '../auth-provider';
import { LoginScreen } from '../login-screen';
import { StatusBanner } from '../status-banner';
import { ActivitiesPanel } from './activities-panel';
import { LocationsPanel } from './locations-panel';
import { OrganizationsPanel } from './organizations-panel';
import { PricingPanel } from './pricing-panel';
import { SchedulesPanel } from './schedules-panel';

const sectionLabels = [
  { key: 'organizations', label: 'Organizations' },
  { key: 'locations', label: 'Locations' },
  { key: 'activities', label: 'Activities' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'schedules', label: 'Schedules' },
];

export function AdminDashboard() {
  const { status, user, isAdmin, logout, error } = useAuth();
  const [activeSection, setActiveSection] = useState('organizations');

  const activeContent = useMemo(() => {
    switch (activeSection) {
      case 'locations':
        return <LocationsPanel />;
      case 'activities':
        return <ActivitiesPanel />;
      case 'pricing':
        return <PricingPanel />;
      case 'schedules':
        return <SchedulesPanel />;
      case 'organizations':
      default:
        return <OrganizationsPanel />;
    }
  }, [activeSection]);

  if (status === 'loading') {
    return (
      <main className='mx-auto flex min-h-screen max-w-lg items-center px-6'>
        <StatusBanner variant='info' title='Loading'>
          Preparing your admin session.
        </StatusBanner>
      </main>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginScreen />;
  }

  return (
    <AppShell
      sections={sectionLabels}
      activeKey={activeSection}
      onSelect={setActiveSection}
      onLogout={logout}
      userEmail={user?.email}
    >
      {error && (
        <StatusBanner variant='error' title='Session'>
          {error}
        </StatusBanner>
      )}
      {!isAdmin && (
        <StatusBanner variant='error' title='Access denied'>
          Your account is not in the admin group.
        </StatusBanner>
      )}
      {isAdmin && activeContent}
    </AppShell>
  );
}
