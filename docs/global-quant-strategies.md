# Quantitative Trading Strategies — Curated Reference & Evidence Review

**Prepared:** Sep 2026 · **Scope:** Global markets, with application notes for Taiwan (TWD) / Asia equity retail traders. All performance figures below are approximate, sourced from cited studies/benchmarks, vary by period, and most are **backtested** unless explicitly flagged as live. **Do not treat any single Sharpe/return figure as a guaranteed forward edge** — see the data-mining/overfitting caveats in §3.

> **Evidence labels used throughout:** 🔬 *Backtested* = from academic backtests; 🟢 *Live-validated* = documented live track record (fund/benchmark/ETP); ⚠️ = significant caveats (small sample, crowding, regime-dependence).

---

## TL;DR — Top-Ranked Shortlist (by evidence strength + longevity)

| # | Strategy | Category | Typical evidence | Retail-accessible? |
|---|----------|----------|------------------|--------------------|
| 1 | **Cross-sectional equity momentum** | Momentum | 🔬 Jegadeesh-Titman 1993, ~1%/mo, Sharpe high; 🟢 long institutional track record | ✅ Long-leg yes; short-leg hard in TW |
| 2 | **Time-series momentum / trend following** | Momentum / cross-asset | 🔬 Moskowitz-Ooi-Pedersen 2012, Sharpe ~0.6–0.8; 🟢 SG Trend, Man AHL, Winton | ✅ Via managed-futures funds/ETPs; retail DIY hard |
| 3 | **Factor investing / smart beta (value, size, low-vol, quality, profitability)** | Factor investing | 🔬 Fama-French 1993/2015, Banz, QMJ; 🟢 AQR, smart-beta ETFs | ✅ **Yes — most accessible** (ETFs, mutual funds) |
| 4 | **Volatility risk premium (selling options)** | Options/volatility | 🔬 VRP literature; 🟢 PutWrite/CB OER indices, short-VIX ETPs | ✅ Long options side easy; 🚫 short side institution-favored |
| 5 | **Carry** (FX, cross-asset) | Cross-asset/macro | 🔬 Koijen et al. 2013, FX carry Sharpe ~0.7; ⚠️ crash risk | ⚠️ FX carry via retail brokers possible; tail risk high |
| 6 | **Pairs trading / stat-arb (mean reversion)** | Statistical arbitrage | 🔬 Gatev-Goetzmann-Rouwenhorst 2006, ~11%/yr; 🟢 D.E. Shaw, Two Sigma | ⚠️ Long-side yes; short leg + costs erode retail edge |
| 7 | **Post-earnings announcement drift (PEAD)** | Event-driven | 🔬 Bernard-Thomas 1989, ~25% ann. long-short; 🟢 institutional | ⚠️ Requires shorting + fast execution |
| 8 | **Merger / risk arbitrage** | Event-driven | 🔬 Mitchell-Pulvino 2001, ~4% excess, Sharpe > market | ✅ Feasible on announced deals (no short needed on target) |
| 9 | **Market making / HFT** | Market making & HFT | 🟢 Baron-Brogaard-Kirilenko, Sharpe ~4.3–9.2 | 🚫 **Institution-only** (infrastructure, latency, co-lo) |
| 10 | **ML/AI alpha (stat-arb at scale)** | ML/AI | 🟢 Renaissance/Medallion ~66% gross, ~39% net; ⚠️ non-replicable | 🚫 **Institution-only**; retail most likely overfits |

**Retail broadly accessible:** smart beta/factor; long equity momentum; long-vol options; announced merger arb; diversified funds (trend, low-vol). **Institution-only:** HFT/market-making, true latency arb, large-scale stat-arb, Renaissance-style ML, capacity-heavy carry books.

---

## 1. Momentum & Trend Following

### 1a. Cross-Sectional Momentum (buy past winners, short past losers)
- **Definition:** Rank stocks by past 3–12-month (skip most recent month) total return; go long top decile, short bottom decile; rebalance monthly.
- **Category:** Momentum.
- **Evidence:** 🔬 Jegadeesh & Titman (1993), *Journal of Finance* [DOI 10.1111/j.1540-6261.1993.tb04702.x](https://doi.org/10.1111/j.1540-6261.1993.tb04702.x) — ~1% per month (12.7% annual) for the 3–12 month look-back, not explained by CAPM/size-B/M. Sharpe typically reported in 0.5–1.0 range across sub-periods; robust internationally (Rouwenhorst 1998; Asness-Moskowitz-Pedersen 2013). 🟢 Live-validated by a generation of quant equity funds (AQR momentum funds, etc.).
- **Capacity:** Large in long leg (can scale to ~$100B+ via index/etf vehicles), but short leg is capacity- and cost-bound and hard-to-borrow names decay fast.
- **Decay/crowding:** The raw anomaly persists but gross margins shrink with smart-beta/momentum ETF crowding; momentum crash risk in reversal months (Daniel & Moskowitz 2016 — "momentum crashes").
- **Implementation/Taiwan:** Long leg is fully doable in TWD (momentum screens + ETFs). 🚫 **Short leg is the constraint** — see §"Short-selling in Taiwan" below: 融券 (margin short) restricted to eligible names + hard-to-borrow (無券可融), forced buyback at record dates, 90% margin. Practical retail approach = **long-only momentum / long-short via ETFs/index futures** (TAIEX futures available, but stock-level shorting is limited).

### 1b. Time-Series Momentum / Trend Following (CTA)
- **Definition:** Each asset is long or short based on **its own** trailing return (e.g., 12-month sign of return); position = sign × volatility-scaled exposure.
- **Category:** Momentum (cross-asset/trend).
- **Evidence:** 🔬 Moskowitz, Ooi & Pedersen (2012), "Time Series Momentum," *J. Financial Economics* 104(2):228–250 [SSRN 2089463](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463) — 58 liquid instruments (equity, currency, commodity, bond futures), ~25+ yrs, positive 12-month TSM for **every** asset; low correlation to standard factors; strong in stress periods ("crisis alpha"). Sharpe ~0.6–0.8 in diversified trend portfolios. 🟢 Live-validated by Man AHL (~$39.4B in trend strategies as of mid-2026, [Man Group](https://www.man.com/capabilities/trend-following)), Winton (Trend Fund, [Q2-2026 report](https://cdn.winton.com/pdfs/2026-Q2-WMFTF-Quarterly-Report.pdf)), and the **SG Trend Index** (launched Jan 2000) — crisis alpha visible in 2001-02, 2008, and 2022 (+27.4% in 2022, best since inception, per [Welton](https://www.welton.com/performance-drivers-return-for-quant-macro-and-trend-following/)/PriceActionLab).
- **Capacity:** Very large — trend following scales to tens of $B easily (Man AHL, Winton, Two Sigma manage exactly this). It's a *liquidity-providing* to *market* strategy, less capacity-constrained than microstructure alpha.
- **Decay:** 2010s were the "lost decade" for trend (low macro-volatility, whipsaw; long-run Sharpe on SG Trend ~0.1 since 2002/10, per [PriceActionLab](https://www.priceactionlab.com/Blog/2023/02/managed-futures-trend-following/)). Returns are regime-dependent, not smooth.
- **Implementation/Taiwan:** ✅ **Most accessible professional long-run strategy for retail** — buy a managed-futures/trend-following fund or UCITS (e.g., AQR, Man AHL, Winton via mutual funds, or ETF trend proxies). DIY cross-asset trend is feasible (Taiwanese brokers offer global futures/forex, but not low-cost). For the Taiwan equity market itself, TSM works on equities/index via TAIEX futures, but is dominated by institutional CTAs in futures globally.

---

## 2. Mean Reversion

### 2a. Pairs Trading / Statistical Arbitrage (distance method)
- **Definition:** Form pairs of stocks with minimum historical *normalized price distance*; when pair spread widens, buy loser/short winner expecting convergence.
- **Category:** Mean reversion / statistical arbitrage.
- **Evidence:** 🔬 Gatev, Goetzmann & Rouwenhorst (2006), "Pairs Trading: Performance of a Relative-Value Arbitrage Rule," *Review of Financial Studies* 19(3):797–827 [Wharton PDF](http://www-stat.wharton.upenn.edu/~steele/Courses/434/434Context/PairsTrading/PairsTradingGGR.pdf) — 1962–2002, annualized excess returns up to ~11% for self-financing top pairs, robust across decades, exceed transaction costs in most periods. 🟢 Live-validated by the stat-arb industry (D.E. Shaw, Two Sigma, Renaissance). ⚠️ The *naive* distance rule is long crowded; modern stat-arb uses cointegration, ML.
- **Capacity/crowding:** Capacity is modest-to-large but alpha decays quickly with crowding. The **"Quant Quake" of August 2007** showed that when many market-neutral stat-arb books deleverage simultaneously, previously "market neutral" strategies all lose together (see [Quant Blueprint](https://www.quantblueprint.com/glossary/statistical-arbitrage), [QuantVPS](https://www.quantvps.com/blog/jim-simons-trading-strategy)).
- **Implementation/Taiwan:** Pairing among liquid large caps + ETFs is possible. 🚫 Shorting half the pair is again the blocker (margin short eligibility + borrow fees + forced buyback). Retail version: long-only mean reversion, or pairs via derivatives on index/constituents. Transaction costs and borrow fees generally eat retail edge.

### 2b. Short-Term Reversal (weekly/monthly)
- **Definition:** Buy recent losers, sell recent winners over very short horizons (few days to 1 month) where short-horizon reversal dominates.
- **Evidence:** 🔬 Jegadeesh (1990), Lehmann (1990) — significant negative autocorrelation at weekly horizons. ⚠️ Costs (bid-ask, shorting) consume a large share; institutional intraday/stat-arb does it in better form at low latency.
- **Implementation:** Retail short-term reversal is cost-dominated; better in futures/ETF baskets. Not a top choice.

---

## 3. Factor Investing / Smart Beta
- **Definition:** Systematic exposure to characteristic "factors" — value, size, momentum, profitability/quality, low-volatility, investment — through long (or long/short) portfolios.
- **Category:** Factor investing / smart beta.
- **Evidence (foundational):**
  - Value & size: Fama & French (1993), *J. Financial Economics* 33(1):3–56 [ScienceDirect 0304-405X(93)90023-5](https://www.sciencedirect.com/science/article/pii/0304405X93900235); Fama & French (2015) Five-Factor *J. Financial Economics* 116(1):1–22 [DOI 10.1016/j.jfineco.2014.10.010](https://doi.org/10.1016/j.jfineco.2014.10.010).
  - Momentum: Carhart (1997) four-factor model.
  - Size (small): Banz (1981).
  - Low-vol/low-beta: Frazzini & Pedersen (2014) "Betting Against Beta" ([AQR](https://www.aqr.com/Insights/Datasets/Value-and-Momentum-Everywhere-Factors-Monthly)).
  - Quality/profitability: Novy-Marx (2013); Asness, Frazzini & Pedersen "Quality Minus Junk."
- **Live-validated:** 🟢 AQR operationalizes these into indices/funds with public monthly factor return data ([AQR Datasets](https://www.aqr.com/Insights/Datasets)); huge smart-beta ETF industry.
- **Capacity:** Large — value/size/low-vol scale to $10s–100s of $B. **Decay:** Premia shrink as they get crowded into ETFs/funds; value had a "lost decade"; size is weak in recent decades. Diversification of *many* factors plus patient holding is the honest edge (AQR view).
- **Implementation/Taiwan:** ✅ **The most retail-friendly category.** Value/low-vol/dividend ETF strategies are straightforward in TWD; factor long legs need no shorting. Momentum via rotation works. Low-vol historically improves Sharpe even long-only.
- **Evidence status:** Factor premia are 🔬 backtested over decades and 🟢 live-validated in products, but forward magnitudes are uncertain (⚠️ crowding).

---

## 4. Statistical Arbitrage (Systematic Market-Neutral, at scale)
- **Definition:** Market-neutral, diversified bets on relative mispricing across thousands of securities using statistical/ML models; the flagship strategy of Renaissance, D.E. Shaw, Two Sigma.
- **Evidence:** 🟢 Medallion ~66% gross / ~39% net annually, **no losing year 1988–2018**, est. Sharpe 8–10+ ([Visual Capitalist](https://www.visualcapitalist.com/growth-of-100-invested-in-jim-simons-medallion-fund/); [Cornell Capital](https://www.cornell-capital.com/blog/medallion-fund-the-ultimate-counterexample/); [Institutional Investor](https://www.institutionalinvestor.com/article/2bswymr8cih3jeaslxc00/portfolio/famed-medallion-fund-stretches-explanation-to-the-limit-professor-claims)). ⚠️ This is **not replicable** — it is a function of proprietary data, ML, execution, and decades of infrastructure.
- **Capacity/crowding:** Capacity large but alpha decays; crowding → 2007 Quant Quake, recurring Q1-2021 quant/stat-arb drawdowns (e.g., small-cap/value factor unwinds).
- **Implementation:** **Institution-only.** Retail should not attempt genuine stat-arb; simpler pairs/short-term mean reversion is more defensible.

---

## 5. Market Making & High-Frequency Trading (HFT)
- **Definition:** Earn bid-ask spread + liquidity rebates by quoting continuously, controlling inventory, at microsecond latency; includes latency arbitrage.
- **Category:** Market making & HFT.
- **Evidence:** 🟢 Baron, Brogaard & Kirilenko, "Risk and Return in High-Frequency Trading," *JFQA* 54(3):993–1024 (2019) [SSRN 2433118](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2433118); [NBER version](https://conference.nber.org/confer/2012/MMf12/Baron_Brogaard_Kirilenko.pdf) — HFT annualized Sharpe ratios roughly **4.3–9.2**, highly concentrated ("winner-takes-all"), profits tied to speed and inventory management.
- **Capacity:** The business is about *capacity of fast trading*, not AUM scale; profitable only at scale with co-location, low-latency feed, colo.
- **Decay/crowding:** Latency arms-race; edge decays as competitors invest in speed.
- **Implementation:** **Institution-only.** 🚫 Not viable for retail (no co-lo, no speed, no exchange rebates). Taiwan/Asia: HFT/market making likewise dominated by prop/HFT desks; retail should avoid attempting it.

---

## 6. Event-Driven

### 6a. Post-Earnings Announcement Drift (PEAD)
- **Definition:** After a positive (negative) earnings surprise, prices keep drifting up (down) for weeks to months; buy on positive SUE, short negative SUE.
- **Evidence:** 🔬 Bernard & Thomas (1989), "Post-Earnings-Announcement Drift," *J. Accounting Research* 27(Suppl.):1–36 [JSTOR 2491062](https://www.jstor.org/stable/2491062); original magnitude from Foster-Olsen-Shevlin (1984): ~25% annualized long-top-decile/short-bottom-decile. Positive drift in 41 of 48 quarters (1974–1985). One of the most persistent anomalies.
- **Capacity/decay:** Decent capacity but requires shorting; has shrunk in the US post-2003 (Reg FD, greater arbitrage), stronger in less-covered/Asia markets.
- **Implementation:** 🟢 Doable in live equity quant. Long-only "price-momentum around earnings" is retail-feasible; the **short leg is hard in Taiwan** (see shorting note). Fast, cost-efficient execution matters.

### 6b. Merger / Risk Arbitrage
- **Definition:** Buy target, short acquirer (stock deals) or buy target with option on completion (cash deals) when a deal is announced, capturing the spread to closing.
- **Evidence:** 🔬 Mitchell & Pulvino (2001), "Characteristics of Risk and Return in Risk Arbitrage," *Journal of Finance* 56(6):2135–2175 [JSTOR 2697819](https://www.jstor.org/stable/2697819) — 4,750 mergers 1963–1998, ~4% annual excess, **Sharpe above the market**, but behaves like *selling deep-OOM index puts*: low equity correlation in normal markets, sharp losses in crashes (deal-break + market tail). 🟢 Live-validated by dedicated event-driven funds.
- **Implementation:** For **cash deals**, retail can buy the target without any shorting (no short leg) — feasible. For **stock deals** you must short the acquirer (hard-to-borrow in TW). Capacity is small-ish in Taiwan (few deals). Not a core retail edge given low deal flow.

### 6c. Other event alpha
- **Definition:** Buybacks, index rebalances, IPOs, spin-offs, earnings-guidance/analyst-revision momentum.
- **Evidence:** Buyback-anomaly documented academically (Ikenberry-Lakonishok-Vermaelen 1995); index addition/delation effects. ⚠️ Smaller scale, fast-moving, often swallowed by transaction costs.
- **Implementation:** Buyback/announcement strategies are retail-doable long-only; index-rebalance alpha is dominated by institutions.

---

## 7. Options / Volatility

### 7a. Volatility Risk Premium (VRP) — selling options/short vol
- **Definition:** Implied vol systematically exceeds realized vol; capture the difference by selling options (covered calls, puts, straddles) or shorting variance/VIX.
- **Evidence:** 🔬/🟢 Robust literature. Covered-call style on S&P 500 ~ Sharpe 0.66, cash-secured put ~ 0.49 (per [option_strategy_vrp](https://agentic-sciences.github.io/assets/papers/option_strategy_vrp.pdf)); risk-managed short-VIX ~0.73 (2016–2026, [QuantConnect](https://www.quantconnect.com/research/21143/harvesting-the-volatility-risk-premium-with-a-dual-vix-signal/)). ⚠️ Payoff is **negatively skewed with fat tails**: steady premium, sudden catastrophic losses (the 2018 "Volmageddon" and 2020 crash). ⚠️ Newer 0DTE ML short-put papers claim out-of-sample Sharpe 4.3–5.8 ([arXiv:2401.03536](https://arxiv.org/abs/2401.03536)) — treat these with skepticism; most Sharpe-implausible results are overfit.
- **Capacity/decay:** Large capacity (options notional) but deep short-vol books are crowded; vol-selling is an "insurance business" that bleeds in range-bound regimes and blows up in tails.
- **Implementation:** ✅ **Long side** (sellers) — retail can sell covered calls / cash-secured puts on TW stocks; ⚠️ naked short vol/VIX needs margin + discipline. 🚫 Retail should not sell naked far-OTM index options.
- **Evidence label:** mix of 🔬 backtested and 🟢 live indices; forward short-vol edge is real but tail-risky.

### 7b. Long vol / volatility timing
- **Definition:** Buy calls/puts or VIX to hedge tail risk; positive option-value in crashes.
- **Evidence:** Long vol is generally a *negative-expectation* standalone strategy (pays the VRP to shorters) but valuable as portfolio hedge. 🔬 documented by many; not an alpha source on its own.

---

## 8. Machine-Learning / AI-Driven
- **Definition:** Use ML (gradient boosting, neural nets, reinforcement learning) on structured + alternative data (tick, satellite, credit-card, news/sentiment, text) to predict cross-sectional or time-series returns at scale.
- **Evidence:** 🟢 Renaissance/Medallion is the archetype (stat-arb+ML edge; ~66% gross). Two Sigma explicitly ML/alt-data. ⚠️ **No public academic result reliably reproduces Renaissance-caliber Sharpe.** Academic ML equity papers (Gu, Kelly & Xiu 2020) show modest out-of-sample improvements over linear factors, not massive alpha. The big published Sharpe/return claims (esp. options-ML) are prone to data snooping.
- **Capacity/decay:** Edge decays fast; requires constant data + compute reinvestment; scaling constrained by liquidity.
- **Implementation:** **Mostly institution-only.** Retail with Python/small compute can build ML screens, but face: no alt-data budget, high overfitting risk (small samples, many trials — see §"backtest overfitting"), survivorship lookahead. For retail, treat ML as signal *augmentation* on top of sound factor/trend logic, not a standalone edge. **Taiwan/Asia:** usable for long-only cross-sectional ranking; avoid short-leg dependence.

**Backtest overfitting warning (applies to all strategies):** López de Prado and Bailey showed that standard backtested Sharpe ratios are inflated by multiple testing / selection bias; use the **Deflated Sharpe Ratio** (Bailey & López de Prado 2014, *JPM* 40(5):94–107 [SSRN 2460551](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551)) and walk-forward tests before believing any backtest. ⚠️ Most retail "high-Sharpe" backtests are overfit; prefer simple, economically-sound signals.

---

## 9. Cross-Asset / Macro / Risk Premia
- **Definition:** Systematically harvest momentum, carry, value, and defensive risk premia across equities, rates, FX, credit, and commodities (e.g., AQR style, Man AHL, Winton multi-strategy).
- **Evidence:**
  - **Carry:** Koijen, Moskowitz, Pedersen & Vrugt (2013), "Carry," NBER WP 19325 [NBER PDF](https://www.nber.org/system/files/working_papers/w19325/w19325.pdf); [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2362320). FX carry Sharpe ~0.7 (cross-asset carry factor up to ~1.1 in backtest). 🟢 Currency carry is a long-standing live institutional/FX strategy. ⚠️ FX carry has severe tail crashes (2008, 2020) that far exceed what Sharpe implies.
  - **Macro/trend/carry/value combos (quant macro):** 🟢 Winton Multi-Strategy UCITS ([wintonucits.com](https://www.wintonucits.com/multi-strategy)), AQR cross-asset risk premia; AQR "A Half Century of Macro Momentum" ([AQR PDF](https://www.aqr.com/-/media/AQR/Documents/Insights/White-Papers/A-Half-Century-of-Macro-Momentum.pdf)).
  - **Managed futures live track record** (see §1b): Man AHL & Winton deliver mid-single-digit long-term annualized with crisis-alpha diversification.
- **Capacity:** The largest of any category (global futures/options liquidity). These are designed to scale to $10s–100s of $B.
- **Decay/crowding:** Individual risk premia shrink/crowd (esp. FX carry), but a diversified multi-premia book partially offsets this; macro-vol regime swings drive periods of flat returns.
- **Implementation:** ✅ **Accessible to retail via managed-futures/risk-parity/target-duration funds and UCITS** (available through Taiwan/Asia fund platforms). DIY FX carry possible via brokers but tail-risk heavy; **not recommended as a standalone retail edge.**

---

## Short-Selling Feasibility in Taiwan (TWD) — Cross-Cutting Constraint 🚫

Taiwan materially limits shorting, which directly caps how much of the long-short academic edge is harvestable by a Taiwanese retail trader:

- **融券 (margin short):** requires a credit account (信用戶); margin deposit typically ~90% of proceeds (FSC can raise it, e.g., to 120% in 2022); you may only short names on the exchange's **eligible list (可融券標的)** — many names have **no available shares (hard-to-borrow / 無券可融)**.
- **借券 (SBL, securities lending):** daily cap ≤ ~10% of previous 30 days' average volume, and aggregate short+lent balance ≤ 25% of free float; hot/high-float names lendable, but crowded/controlled names are effectively impossible to borrow ([TWSE 融券vs借券](https://www.twse.com.tw/rwd/staticFiles/product/publication/0001069227.pdf); [FSC short-selling/lending note](https://solutions-atlantic.com/taiwan-fsc-short-selling-and-stock-lending/)).
- **Forced buyback (強制回補):** shorts must be covered before record dates (shareholder meetings, dividends), causing squeeze/gap risk; borrow fees rise when supply is tight.
- **Net implication:** Retail in Taiwan can reliably run **long-only** versions (long momentum, value/low-vol factors, cash-secured puts, cash-deal merger arb, trend via funds), and short **via index/ETF futures** (TAIEX futures) or cross-border products — but **stock-level market-neutral shorting and pairs/stat-arb short legs are largely off-limits**. This tilts the realistic Taiwanese retail playbook toward factor/smart-beta + long momentum + trend-through-funds + long-vol-option strategies over short-heavy ones.

---

## Appendix — Key Seminal References

| Strategy | Seminal reference | URL |
|----------|-------------------|-----|
| Cross-sectional momentum | Jegadeesh & Titman (1993), *J. Finance* 48(1):65–91 | doi.org/10.1111/j.1540-6261.1993.tb04702.x |
| Momentum crashes | Daniel & Moskowitz (2016), "Momentum Crashes," *J. Financial Economics* | sciencedirect (S0165410116000094) |
| Time-series momentum / trend | Moskowitz, Ooi & Pedersen (2012), *JFE* 104(2):228–250 | papers.ssrn.com/abstract=2089463 |
| Value & size (3-factor) | Fama & French (1993), *JFE* 33(1):3–56 | sciencedirect.com/article/pii/0304405X93900235 |
| Five-factor model | Fama & French (2015), *JFE* 116(1):1–22 | doi.org/10.1016/j.jfineco.2014.10.010 |
| Momentum 4-factor | Carhart (1997), *J. Finance* 52(1):57–82 | doi.org/10.1111/j.1540-6261.1997.tb03808.x |
| Low-vol / Betting Against Beta | Frazzini & Pedersen (2014), *JPE* 122(1):40–55 | AQR: aqr.com/Insights/Datasets |
| Quality Minus Junk | Asness, Frazzini & Pedersen (2019), *RAPS* 4(1):34–59 | doi.org/10.1177/2337002219844035 |
| Pairs trading / stat-arb | Gatev, Goetzmann & Rouwenhorst (2006), *RFS* 19(3):797–827 | wharton.upenn.edu PairsTradingGGR.pdf |
| PEAD | Bernard & Thomas (1989), *JAR* 27(Suppl.):1–36 | jstor.org/stable/2491062 |
| Merger arb | Mitchell & Pulvino (2001), *J. Finance* 56(6):2135–75 | jstor.org/stable/2697819 |
| Carry | Koijen, Moskowitz, Pedersen & Vrugt (2013), "Carry" | nber.org w19325.pdf |
| Volatility risk premium | Overview: quantpedia "Overview of Short Volatility Strategies" | quantpedia.com/overview-of-different-short-volatility-strategies/ |
| HFT profitability | Baron, Brogaard & Kirilenko (2019), *JFQA* 54(3) | papers.ssrn.com/abstract=2433118 |
| Backtest overfitting / Deflated Sharpe | Bailey & López de Prado (2014), *JPM* 40(5):94–107 | papers.ssrn.com/abstract=2460551 |
| Data snooping | López de Prado, *Advances in Financial Machine Learning* (2018) | Wiley |
| ML in asset pricing | Gu, Kelly & Xiu (2020), *RFS* 33(5):2223–73 | academic.oup.com/rfs |
| Macro momentum (cross-asset) | AQR, "A Half Century of Macro Momentum" (2017) | aqr.com WHITE-PAPERS PDF |
| Medallion evidence | Visual Capitalist / Institutional Investor | visualcapitalist.com ... medallion-fund |

---

## Sources / Notes on Evidence Confidence

- **Sharpe ratios** above are cross-period, cross-methodology approximations drawn from the cited works and public benchmarks; **none should be read as a guaranteed forward expectancy**. Vary by period and execution.
- **Backtested (🔬) vs Live-validated (🟢):** Trend/CTA (SG Trend Index, Man AHL, Winton), factor products (AQR, smart-beta ETFs), VRP (PutWrite indices), HFT (Baron-Brogaard-Kirilenko firm data), stat-arb (Medallion track record) all have genuine **live** evidence. Pure academic anomalies (PEAD magnitude, momentum %/month, pairs ~11%/yr, FX-carry ~0.7) are primarily **backtested** and partially decayed/crowded since publication.
- **Inflation/no-fabrication check:** Where the literature or index data did not give an exact number, I used ranges or omitted specifics rather than inventing them. Figures like Medallion ~39–40% net, Man Group ~$39.4B trend AUM, SG Trend 2022 +27.4%, and FX-carry ~0.7 Sharpe are from the cited public sources above; all carry period-caveats.
- **Taiwan short-sale facts** (90% margin, eligible-listing, 25% aggregate borrow cap, forced buyback, hard-to-borrow/無券可融) are from TWSE/FSC materials cited above — current regulatory numbers should be re-checked before live trading.

### Research gaps / caveats for follow-up
- I did **not** find a widely trusted public source for a precise, forward-looking Medallion Sharpe ratio (figures are analyst estimates, not disclosed) — flagged as such.
- Exact live Taiwan (TWD) implementation of each strategy (specific fee schedules, individual shorting eligibility per stock) requires broker/regulatory confirmation; general rules are cited.
- 2022+ 0DTE ML short-put Sharpe claims are from a preprint (arXiv) — **treat as unverified**; not counted among "strong, established" evidence.