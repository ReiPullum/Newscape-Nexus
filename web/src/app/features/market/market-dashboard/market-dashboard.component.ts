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
  templateUrl: "./market-dashboard.component.html",
  styleUrl: "./market-dashboard.component.css"
})
export class MarketDashboardComponent implements OnInit {
  items: MarketItem[] = [];
  loading = false;
  error = '';
  searchItemId = '';
  suggestions: RS3Item[] = [];
  showSuggestions = false;
  selectedChangeWindowByItemId: Record<number, ChangeWindow> = {};
  selectedTradedWindowByItemId: Record<number, TradedWindow> = {};

  private readonly defaultItemIds = [4151, 11840, 11286, 15241];

  constructor(private marketData: MarketDataService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.error = '';
    this.loading = true;

    const calls = this.defaultItemIds.map((id) =>
      firstValueFrom(this.marketData.getItem(id)).catch((err) => {
        console.error('[Market] Item load failed for', id, ':', err);
        return null;
      })
    );

    Promise.all(calls).then((results) => {
      this.items = results.filter((it): it is MarketItem => !!it);
      this.loading = false;
      this.cdr.markForCheck();
      if (this.items.length === 0) {
        this.error = 'Could not load any market items.';
      }
    }).catch((err) => {
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

    this.error = '';
    this.loading = true;
    this.showSuggestions = false;

    firstValueFrom(this.marketData.getItem(id))
      .then((item) => {
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

    const matched = RS3_ITEMS.filter(item =>
      item.name.toLowerCase().includes(input) ||
      item.id.toString().startsWith(input)
    );

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

    this.suggestions = matched.slice(0, 20);
    this.showSuggestions = this.suggestions.length > 0;
    this.cdr.markForCheck();
  }

  selectSuggestion(item: RS3Item) {
    this.searchItemId = item.id.toString();
    this.showSuggestions = false;
    this.suggestions = [];
    setTimeout(() => this.searchItem(), 0);
  }

  closeSuggestions() {
    this.showSuggestions = false;
  }

  setChangeWindow(itemId: number, window: ChangeWindow) {
    this.selectedChangeWindowByItemId[itemId] = window;
  }

  setTradedWindow(itemId: number, window: TradedWindow) {
    this.selectedTradedWindowByItemId[itemId] = window;
  }

  getChangeWindow(itemId: number): ChangeWindow {
    return this.selectedChangeWindowByItemId[itemId] || "1d";
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
}