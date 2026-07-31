import { Routes } from '@angular/router';


export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../shared/components/layout').then(m => m.DefaultLayoutComponent),
    data: { title: 'Manager Area' },
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('../../shared/components/dashboard/dashboard.component').then(m => m.DashboardComponent),
        data: { title: 'Dashboard' }
      },
      {
        path: 'manage-orders',
        loadComponent: () =>
          import('../staff/manage-orders/manage-orders.component').then(m => m.ManageOrdersComponent),
        data: { title: 'Orders' }
      },
      {
        path: 'table-orders',
        loadComponent: () =>
          import('../staff/table-orders-by-date/table-orders-by-date.component').then(m => m.TableOrdersByDateComponent),
        data: { title: 'Order history' }
      },
      {
        path: 'reservations',
        redirectTo: '/staff/bookings',
        pathMatch: 'full'
      },
      {
        path: 'manage-tables',
        loadComponent: () =>
          import('./manage-tables/manage-tables.component').then(m => m.ManageTablesComponent),
        data: { title: 'Staff' }
      },
      {
        path: 'manage-menu',
        loadComponent: () =>
          import('./manage-menu/manage-menu.component').then(m => m.ManageMenuComponent),
        data: { title: 'Menu' }
      },
      {
        path: 'recipes',
        loadComponent: () =>
          import('./manage-recipes/manage-recipes.component').then(m => m.ManageRecipesComponent),
        data: { title: 'Recipes' }
      },
      {
        path: 'manage-bars',
        redirectTo: '/staff/bar',
        pathMatch: 'full'
      },
      {
        path: 'manage-staff',
        loadComponent: () =>
          import('./manage-staff/manage-staff.component').then(m => m.ManageStaffComponent),
        data: { title: 'Staff' }
      },
      {
        path: 'manage-qrs',
        loadComponent: () =>
          import('./manage-qrs/manage-qrs.component').then(m => m.ManageQrsComponent),
        data: { title: 'QR Codes' }
      },
      {
        path: 'manage-qrs-links',
        loadComponent: () =>
          import('./manage-qrs-links/manage-qrs-links.component').then(m => m.ManageQrsLinksComponent),
        data: { title: 'QR Links' }
      },
      {
        path: 'reports/login-logout',
        loadComponent: () =>
          import('./login-logout-report/login-logout-report.component').then(
            m => m.LoginLogoutReportComponent
          ),
        data: { title: 'Login & logout report' }
      },
      {
        path: 'reports/sales',
        loadComponent: () =>
          import('./sales-reports/sales-reports.component').then(m => m.SalesReportsComponent),
        data: { title: 'Sales & accounting reports' }
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./manager-settings/manager-settings.component').then(m => m.ManagerSettingsComponent),
        data: { title: 'Settings' }
      }
    ]
  }
];
