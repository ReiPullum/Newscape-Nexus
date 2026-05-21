import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'market', loadChildren: () => import('./features/market/market.module').then(m => m.MarketModule) },
  { path: 'profile', loadComponent: () => import('./features/profile/profile-search/profile-search').then(m => m.ProfileSearch) },
  { path: '', redirectTo: '/market', pathMatch: 'full' },
  { path: '**', redirectTo: '/market' }
];