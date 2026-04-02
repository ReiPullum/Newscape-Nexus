import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarketRoutingModule } from './market-routing.module';
import { MarketDashboardComponent } from './market-dashboard/market-dashboard.component';

@NgModule({
  declarations: [MarketDashboardComponent],
  imports: [CommonModule, MarketRoutingModule]
})
export class MarketModule {}
