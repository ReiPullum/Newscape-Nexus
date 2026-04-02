import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";
import { MarketDashboardComponent } from "./market-dashboard/market-dashboard.component";

const routes: Routes = [
  { path: "", component: MarketDashboardComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class MarketRoutingModule {}
