import { TestBed } from '@angular/core/testing';

import { GePrices } from './ge-prices';

describe('GePrices', () => {
  let service: GePrices;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GePrices);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
