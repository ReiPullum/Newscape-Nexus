import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'market', loadChildren: () => import('./features/market/market.module').then(m => m.MarketModule) },
  { path: '', redirectTo: '/market', pathMatch: 'full' },
  { path: '**', redirectTo: '/market' }
];
