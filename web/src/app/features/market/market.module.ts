import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MarketRoutingModule } from "./market-routing.module";
import { MarketDashboardComponent } from "./market-dashboard/market-dashboard.component";

@NgModule({
  imports: [CommonModule, MarketRoutingModule, MarketDashboardComponent]
})
export class MarketModule {}
