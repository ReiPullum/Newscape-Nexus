import { Component } from "@angular/core";

@Component({
  selector: "app-market-dashboard",
  standalone: true,
  template: `
    <section class="market-shell">
      <h2>Market Dashboard</h2>
      <p>Welcome to the Bazaar of Newscape.</p>
      <div class="cards">
        <article class="card">
          <h3>Grand Exchange Prices</h3>
          <p>Track trending items like Rune scimitar, Dragon darts, and Mystic robes.</p>
        </article>
        <article class="card">
          <h3>Supply & Demand</h3>
          <p>City supply data with medieval-inspired UI components.</p>
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

      .cards {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .card {
        background: rgba(10, 12, 20, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.75rem;
        padding: 1rem;
        backdrop-filter: blur(5px);
      }

      .card h3 {
        margin-top: 0;
        font-size: 1.2rem;
        font-family: "Cinzel", serif;
        text-shadow: 0 0 4px rgba(240, 220, 175, 0.5);
      }

      .card p {
        margin: 0.5rem 0 0;
        color: #d8c29b;
        line-height: 1.4;
      }
    `
  ]
})
export class MarketDashboardComponent {}
