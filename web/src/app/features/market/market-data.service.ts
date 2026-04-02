import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface MarketItem {
  id: number;
  name: string;
  currentPrice: number;
  dailyChange: number;
  buyQuantity: number;
  sellQuantity: number;
  lastUpdated: string;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  // Backend API (full-stack): http://localhost:3000/api/market
  // For MVP you can use direct RuneScape endpoint if CORS allows.
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
          buyQuantity: 0,
          sellQuantity: 0,
          lastUpdated: item.fetchedAt || new Date().toISOString(),
        };
      })
    );
  }

  getItems(itemIds: number[]): Observable<MarketItem[]> {
    return this.http.post<any>(`${this.baseUrl}/batch`, { itemIds });
  }
}
