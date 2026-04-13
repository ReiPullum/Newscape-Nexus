import { Component, OnInit, ChangeDetectorRef } from "@angular/core";
import { CommonModule, DecimalPipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { MarketDataService, MarketItem } from "../market-data.service";
import { RS3_ITEMS, RS3Item } from "../item-database";

type ChangeWindow = "1d" | "30d" | "90d" | "180d";
type TradedWindow = "1d" | "7d" | "14d";

@Component({
  selector: "app-market-dashboard",
  standalone: true,
  imports: [CommonModule, DecimalPipe, FormsModule],
  template: `
    <section class="market-shell">
      <h2>Market Dashboard</h2>
      <p>Welcome to the Bazaar of Newscape.</p>

      <div class="controls">
        <button class="refresh" (click)="refresh()" [disabled]="loading">Refresh data</button>
        
        <div class="search-box">
          <div class="search-input-wrapper">
            <input 
              type="text" 
              [(ngModel)]="searchItemId" 
              (input)="onSearchInput()"
              (keyup.enter)="searchItem()"
              placeholder="Search by name or ID..."
              [disabled]="loading"
            />
            <ul class="suggestions" *ngIf="showSuggestions && suggestions.length">
              <li *ngFor="let suggestion of suggestions" (click)="selectSuggestion(suggestion)" class="suggestion-item">
                <span class="suggestion-name">{{ suggestion.name }}</span>
                <span class="suggestion-id">#{{ suggestion.id }}</span>
              </li>
            </ul>
          </div>
          <button class="search-btn" (click)="searchItem()" [disabled]="loading">Search</button>
        </div>
      </div>

      <p *ngIf="loading" class="status">Loading...</p>
      <p *ngIf="error" class="status error">Error: {{ error }}</p>

      <div class="cards" *ngIf="!loading && items.length">
        <article class="card" *ngFor="let item of items">
          <h3>{{ item.name }}</h3>
          <p>Current value: {{ item.currentPrice | number }}</p>
          <div class="change-row">
            <button class="change-toggle" type="button" (click)="toggleChangeMenu(item.id)">
              Change window: {{ getChangeWindowLabel(item.id) }}
            </button>
            <div class="change-menu" *ngIf="openChangeMenuForItemId === item.id">
              <button type="button" (click)="setChangeWindow(item.id, '1d')">1 day</button>
              <button type="button" (click)="setChangeWindow(item.id, '30d')">1 month</button>
              <button type="button" (click)="setChangeWindow(item.id, '90d')">3 months</button>
              <button type="button" (click)="setChangeWindow(item.id, '180d')">6 months</button>
            </div>
          </div>
          <p>
            {{ getChangeWindowLabel(item.id) }} change:
            {{ getSelectedChangeValue(item) | number }}
            <span [ngClass]="getSelectedChangeClass(item)">{{ formatSelectedChangePercent(item) }}</span>
          </p>
          <div class="change-row">
            <button class="change-toggle" type="button" (click)="toggleTradedMenu(item.id)">
              Traded window: {{ getTradedWindowLabel(item.id) }}
            </button>
            <div class="change-menu" *ngIf="openTradedMenuForItemId === item.id">
              <button type="button" (click)="setTradedWindow(item.id, '1d')">1 day</button>
              <button type="button" (click)="setTradedWindow(item.id, '7d')">1 week</button>
              <button type="button" (click)="setTradedWindow(item.id, '14d')">2 weeks</button>
            </div>
          </div>
          <p>
            {{ getTradedWindowLabel(item.id) }} traded avg:
            {{ getSelectedTradedAmount(item) | number }}
          </p>
        </article>
      </div>
    </section>
  `,
  styles: [
    `
      .market-shell {
        background: linear-gradient(145deg, rgba(40, 38, 50, 0.9), rgba(10, 12, 16, 0.95));
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 1rem;
        box-shadow: 0 12px 35px rgba(0, 0, 0, 0.45);
        color: #f2e5c3;
        padding: 2rem;
      }

      .market-shell h2 {
        margin: 0 0 0.5rem 0;
        font-size: 2.2rem;
        letter-spacing: 0.08em;
        color: #ead9b6;
      }

      .market-shell p {
        margin: 0 0 1.5rem 0;
        color: #d8c29b;
      }

      .refresh {
        margin-bottom: 1rem;
        background: #382f66;
        border: 1px solid #8e7fce;
        color: #f2e6c3;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        cursor: pointer;
      }

      .controls {
        display: flex;
        gap: 1rem;
        margin-bottom: 1.5rem;
        align-items: center;
        flex-wrap: wrap;
      }

      .search-box {
        display: flex;
        gap: 0.5rem;
      }

      .search-input-wrapper {
        position: relative;
        flex: 1;
      }

      .search-box input {
        background: rgba(10, 12, 20, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #f2e6c3;
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        font-size: 0.9rem;
        width: 100%;
        min-width: 150px;
      }

      .search-box input::placeholder {
        color: #8e7fce;
      }

      .search-box input:focus {
        outline: none;
        border-color: #8e7fce;
        box-shadow: 0 0 8px rgba(142, 127, 206, 0.3);
      }

      .suggestions {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: rgba(10, 12, 20, 0.95);
        border: 1px solid rgba(142, 127, 206, 0.5);
        border-top: none;
        border-radius: 0 0 0.5rem 0.5rem;
        list-style: none;
        margin: 0;
        padding: 0.25rem 0;
        max-height: 200px;
        overflow-y: auto;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .suggestion-item {
        padding: 0.5rem 0.75rem;
        color: #d8c29b;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
      }

      .suggestion-item:hover {
        background: rgba(142, 127, 206, 0.2);
        color: #f2e6c3;
      }

      .suggestion-name {
        flex: 1;
      }

      .suggestion-id {
        font-size: 0.8em;
        color: #8e7fce;
        white-space: nowrap;
      }

      .search-btn {
        background: #8e7fce;
        border: 1px solid #8e7fce;
        color: #1a1620;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        cursor: pointer;
        font-weight: 600;
      }

      .search-btn:hover:not(:disabled) {
        background: #a89fe0;
      }

      .refresh:disabled,
      .search-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .status { margin-bottom: 1rem; }
      .status.error { color: #ff6d6d; }

      .cards { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .card { background: rgba(10, 12, 20, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.75rem; padding: 1rem; backdrop-filter: blur(5px); }
      .card h3 { margin-top: 0; font-size: 1.2rem; font-family: "Cinzel", serif; text-shadow: 0 0 4px rgba(240, 220, 175, 0.5); }
      .card p { margin: 0.45rem 0 0; color: #d8c29b; line-height: 1.4; }

      .change-row { margin-top: 0.45rem; position: relative; }
      .change-toggle {
        background: rgba(142, 127, 206, 0.2);
        border: 1px solid rgba(142, 127, 206, 0.6);
        color: #f2e6c3;
        border-radius: 0.4rem;
        padding: 0.35rem 0.55rem;
        cursor: pointer;
      }
      .change-menu {
        margin-top: 0.4rem;
        display: grid;
        gap: 0.25rem;
      }
      .change-menu button {
        background: rgba(10, 12, 20, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #f2e6c3;
        border-radius: 0.35rem;
        padding: 0.3rem 0.5rem;
        text-align: left;
        cursor: pointer;
      }
      
      .positive { color: #2ecc71; font-weight: 600; }
      .negative { color: #e74c3c; font-weight: 600; }
    `
  ]
})
export class MarketDashboardComponent implements OnInit {
  items: MarketItem[] = [];
  loading = false;
  error = '';
  searchItemId = '';
  suggestions: RS3Item[] = [];
  showSuggestions = false;
  openChangeMenuForItemId: number | null = null;
  selectedChangeWindowByItemId: Record<number, ChangeWindow> = {};
  openTradedMenuForItemId: number | null = null;
  selectedTradedWindowByItemId: Record<number, TradedWindow> = {};

  private readonly defaultItemIds = [4151, 11840, 11286, 15241];

  constructor(private marketData: MarketDataService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    console.log('[Market] Component initialized, calling refresh()');
    this.refresh();
  }

  refresh() {
    console.log('[Market] Refresh called with IDs:', this.defaultItemIds);
    this.error = '';
    this.loading = true;

    const calls = this.defaultItemIds.map((id) =>
      firstValueFrom(this.marketData.getItem(id)).catch((err) => {
        console.error('[Market] Item load failed for', id, ':', err);
        return null;
      })
    );

    Promise.all(calls).then((results) => {
      console.log('[Market] All requests finished. Results:', results);
      this.items = results.filter((it): it is MarketItem => !!it);
      this.loading = false;
      this.cdr.markForCheck();
      console.log('[Market] Loaded', this.items.length, 'items');
      if (this.items.length === 0) {
        this.error = 'Could not load any market items.';
      }
    }).catch((err) => {
      console.error('[Market] Promise.all error:', err);
      this.loading = false;
      this.error = 'Failed to load items: ' + err?.message;
      this.cdr.markForCheck();
    });
  }

  searchItem() {
    const id = Number(this.searchItemId);
    if (!id || id < 1) {
      this.error = 'Please enter a valid item ID';
      return;
    }

    console.log('[Market] Searching for item:', id);
    this.error = '';
    this.loading = true;
    this.showSuggestions = false;

    firstValueFrom(this.marketData.getItem(id))
      .then((item) => {
        console.log('[Market] Search result:', item);
        this.items = [item];
        this.loading = false;
        this.cdr.markForCheck();
      })
      .catch((err) => {
        console.error('[Market] Search failed for', id, ':', err);
        this.items = [];
        this.loading = false;
        this.error = `Item ${id} not found`;
        this.cdr.markForCheck();
      });
  }

  onSearchInput() {
    const input = this.searchItemId.trim().toLowerCase();
    
    if (!input) {
      this.suggestions = [];
      this.showSuggestions = false;
      return;
    }

    // Filter items that match the input (by name or ID)
    const matched = RS3_ITEMS.filter(item =>
      item.name.toLowerCase().includes(input) ||
      item.id.toString().startsWith(input)
    );

    // Sort: exact word match > starts-with > any word starts-with > contains anywhere
    matched.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aWords = aName.split(/\s+/);
      const bWords = bName.split(/\s+/);
      const aExactWord = aWords.includes(input);
      const bExactWord = bWords.includes(input);
      if (aExactWord !== bExactWord) return aExactWord ? -1 : 1;
      const aStarts = aName.startsWith(input);
      const bStarts = bName.startsWith(input);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      const aWordStarts = aWords.some(w => w.startsWith(input));
      const bWordStarts = bWords.some(w => w.startsWith(input));
      if (aWordStarts !== bWordStarts) return aWordStarts ? -1 : 1;
      return aName.localeCompare(bName);
    });

    this.suggestions = matched.slice(0, 20); // Show more suggestions for broad terms

    this.showSuggestions = this.suggestions.length > 0;
    this.cdr.markForCheck();
  }

  selectSuggestion(item: RS3Item) {
    this.searchItemId = item.id.toString();
    this.showSuggestions = false;
    this.suggestions = [];
    
    // Trigger search
    setTimeout(() => this.searchItem(), 0);
  }

  closeSuggestions() {
    this.showSuggestions = false;
  }

  toggleChangeMenu(itemId: number) {
    this.openChangeMenuForItemId = this.openChangeMenuForItemId === itemId ? null : itemId;
  }

  setChangeWindow(itemId: number, window: ChangeWindow) {
    this.selectedChangeWindowByItemId[itemId] = window;
    this.openChangeMenuForItemId = null;
  }

  toggleTradedMenu(itemId: number) {
    this.openTradedMenuForItemId = this.openTradedMenuForItemId === itemId ? null : itemId;
  }

  setTradedWindow(itemId: number, window: TradedWindow) {
    this.selectedTradedWindowByItemId[itemId] = window;
    this.openTradedMenuForItemId = null;
  }

  getTradedWindow(itemId: number): TradedWindow {
    return this.selectedTradedWindowByItemId[itemId] || "1d";
  }

  getTradedWindowLabel(itemId: number): string {
    const window = this.getTradedWindow(itemId);
    if (window === "1d") return "1 day";
    return window === "14d" ? "2 weeks" : "1 week";
  }

  getSelectedTradedAmount(item: MarketItem): number {
    const window = this.getTradedWindow(item.id);
    if (window === "1d") return item.amountTraded;
    if (window === "14d") return item.amountTraded14dAvg;
    return item.amountTraded7dAvg;
  }

  getChangeWindow(itemId: number): ChangeWindow {
    return this.selectedChangeWindowByItemId[itemId] || "1d";
  }

  getChangeWindowLabel(itemId: number): string {
    const window = this.getChangeWindow(itemId);
    if (window === "30d") return "1 month";
    if (window === "90d") return "3 months";
    if (window === "180d") return "6 months";
    return "1 day";
  }

  getSelectedChangePercent(item: MarketItem): number {
    const window = this.getChangeWindow(item.id);
    if (window === "30d") return item.day30ChangePercent;
    if (window === "90d") return item.day90ChangePercent;
    if (window === "180d") return item.day180ChangePercent;
    if (item.currentPrice === 0) return 0;
    return (item.dailyChange / item.currentPrice) * 100;
  }

  getSelectedChangeValue(item: MarketItem): number {
    const window = this.getChangeWindow(item.id);
    if (window === "1d") return item.dailyChange;
    if (window === "30d") return item.day30ChangeValue;
    if (window === "90d") return item.day90ChangeValue;
    if (window === "180d") return item.day180ChangeValue;

    const percent = this.getSelectedChangePercent(item);
    const multiplier = 1 + percent / 100;
    if (multiplier <= 0 || item.currentPrice === 0) return 0;

    // Jagex month percentages are relative to the old price.
    // old * (1 + p/100) = current => old = current / (1 + p/100)
    const oldPrice = item.currentPrice / multiplier;
    return Math.round(item.currentPrice - oldPrice);
  }

  formatSelectedChangePercent(item: MarketItem): string {
    const percent = this.getSelectedChangePercent(item);
    const sign = percent > 0 ? "+" : "";
    return `${sign}${percent.toFixed(1)}%`;
  }

  getSelectedChangeClass(item: MarketItem): string {
    const percent = this.getSelectedChangePercent(item);
    return percent > 0 ? "positive" : percent < 0 ? "negative" : "";
  }

  calculatePercentChange(dailyChange: number, currentPrice: number): string {
    if (currentPrice === 0) return '0.0%';
    const percentChange = (dailyChange / currentPrice) * 100;
    const sign = percentChange > 0 ? '+' : '';
    return `${sign}${percentChange.toFixed(1)}%`;
  }

  getPercentChangeClass(dailyChange: number, currentPrice: number): string {
    if (currentPrice === 0) return '';
    const percentChange = (dailyChange / currentPrice) * 100;
    return percentChange > 0 ? 'positive' : percentChange < 0 ? 'negative' : '';
  }
}

