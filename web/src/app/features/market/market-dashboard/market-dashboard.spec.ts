import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MarketDashboard } from './market-dashboard';

describe('MarketDashboard', () => {
  let component: MarketDashboard;
  let fixture: ComponentFixture<MarketDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarketDashboard],
    }).compileComponents();

    fixture = TestBed.createComponent(MarketDashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
