'use client';

import { AdminDashboard } from '../components/admin/admin-dashboard';
import { AuthProvider } from '../components/auth-provider';

export default function HomePage() {
  return (
    <AuthProvider>
      <AdminDashboard />
    </AuthProvider>
  );
}
