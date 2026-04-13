import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface MarketItem {
  id: number;
  name: string;
  currentPrice: number;
  dailyChange: number;
  day30ChangeValue: number;
  day90ChangeValue: number;
  day180ChangeValue: number;
  day30ChangePercent: number;
  day90ChangePercent: number;
  day180ChangePercent: number;
  amountTraded: number;
  amountTraded7dAvg: number;
  amountTraded14dAvg: number;
  lastUpdated: string;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  // Backend API (full-stack): http://localhost:3000/api/market
  // Keep API URL in frontend environment config for production deployments.
  private baseUrl = 'http://localhost:3000/api/market';

  constructor(private http: HttpClient) {}

  getItem(itemId: number): Observable<MarketItem> {
    console.log('[MarketDataService] Requesting item:', itemId);
    return this.http.get<any>(`${this.baseUrl}/${itemId}`).pipe(
      map((item) => {
        console.log('[MarketDataService] Got response for', itemId, ':', item);
        return {
          id: item.id,
          name: item.name,
          currentPrice: item.current?.price || 0,
          dailyChange: item.today?.price || 0,
          day30ChangeValue: item.day30?.changeValue || 0,
          day90ChangeValue: item.day90?.changeValue || 0,
          day180ChangeValue: item.day180?.changeValue || 0,
          day30ChangePercent: item.day30?.changePercent || 0,
          day90ChangePercent: item.day90?.changePercent || 0,
          day180ChangePercent: item.day180?.changePercent || 0,
          amountTraded: item.amountTraded || 0,
          amountTraded7dAvg: item.amountTraded7dAvg || 0,
          amountTraded14dAvg: item.amountTraded14dAvg || 0,
          lastUpdated: item.fetchedAt || new Date().toISOString(),
        };
      })
    );
  }

  getItems(itemIds: number[]): Observable<MarketItem[]> {
    return this.http.post<any>(`${this.baseUrl}/batch`, { itemIds });
  }
}
