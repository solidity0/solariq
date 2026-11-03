// SolarIQ sizing engine — follows the AUDITING sheet of the "AUDIT QUOTATION with parallel
// function" workbook: battery bank from DoD and efficiency, panels sized to refill the bank,
// PV strings fitted to the inverter, the data-sheet checks, and the itemised accessories list.
// Pure functions only (no DOM), so it can be tested outside the browser.
(function (root) {
  'use strict';

  const BREAKER_SIZES = [15, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const nextBreaker = amps => BREAKER_SIZES.find(s => amps < s) || Math.ceil(amps / 10) * 10;

  // Battery round-trip efficiency (sheet E33): lithium 90%, everything else 80%
  const battEfficiency = batt => (batt && batt.chem === 'lithium') ? 0.90 : 0.80;

  // All catalog items of one tab as a flat list, each tagged with its brand
  function flat(catalog, tab) {
    const out = [];
    ((catalog && catalog[tab]) || []).forEach(b => (b.items || []).forEach(it => out.push(Object.assign({ brand: b.brand }, it))));
    return out;
  }
  function findItem(catalog, tab, id) {
    return flat(catalog, tab).find(it => it.id === id) || null;
  }

  // Smallest inverter of the brand that covers the load on its own; otherwise the
  // parallel-capable model that needs the fewest units (sheet: D51 = D50 × E51 ≥ E50)
  function pickInverter(catalog, brand, requiredKW, battVolt) {
    const all = flat(catalog, 'inverters');
    let pool = all.filter(i => !brand || (i.brand || '').toLowerCase() === brand.toLowerCase());
    if (!pool.length) pool = all;
    const voltOk = pool.filter(i => !battVolt || i.volt === battVolt);
    if (voltOk.length) pool = voltOk;
    pool = pool.slice().sort((a, b) => a.kw - b.kw || a.userPrice - b.userPrice);
    const single = pool.find(i => i.kw >= requiredKW);
    if (single) return { inverter: single, units: 1 };
    const par = pool.filter(i => i.parallel === 'yes' && i.maxParallel > 1)
      .map(i => ({ inverter: i, units: Math.ceil(requiredKW / i.kw) }))
      .filter(o => o.units <= o.inverter.maxParallel)
      .sort((a, b) => a.units - b.units || (a.inverter.userPrice * a.units) - (b.inverter.userPrice * b.units));
    if (par.length) return par[0];
    const biggest = pool[pool.length - 1];
    return biggest ? { inverter: biggest, units: Math.ceil(requiredKW / biggest.kw) } : { inverter: null, units: 1 };
  }

  function priceOf(item, field) {
    if (!item) return 0;
    return Number(item[field]) || Number(item.userPrice) || Number(item.dealerPrice) || 0;
  }

  /**
   * size(input) → full design.
   * input: { loadW, energyWh, catalog, priceField ('userPrice'|'dealerPrice'),
   *          inverterId|'auto', inverterBrand, invUnits (0 = auto), batteryId, panelId, withSolar,
   *          cfg: { systemLoss, daysOfAutonomy, sunHours, chargeLoss, panelEff, powerFactor, installPct, logistics, markupPct } }
   */
  function size(input) {
    const cfg = Object.assign({ systemLoss: 0.20, daysOfAutonomy: 1, sunHours: 5, chargeLoss: 0.50,
      panelEff: 0.80, powerFactor: 0.80, installPct: 0.08, logistics: 0, markupPct: 0 }, input.cfg || {});
    const catalog = input.catalog;
    const field = input.priceField || 'userPrice';
    const withSolar = input.withSolar !== false;
    const loadW = Math.max(0, Number(input.loadW) || 0);
    const energyWh = Math.max(0, Number(input.energyWh) || 0);
    const empty = loadW <= 0;

    // ── Energy (sheet J31 / I31) ──────────────────────────────────
    const adjustedEnergyWh = energyWh * (1 + cfg.systemLoss);

    // ── Battery (sheet E33–J36) ───────────────────────────────────
    const battery = findItem(catalog, 'batteries', input.batteryId) || flat(catalog, 'batteries')[0] || null;
    const panel = findItem(catalog, 'panels', input.panelId) || flat(catalog, 'panels')[0] || null;

    // Sheet I43/J43: kW ÷ power factor ÷ inverter efficiency, rounded up to a whole kW
    const requiredFor = inv => loadW / cfg.powerFactor / ((inv && inv.eff) || 0.80) / 1000;
    const minUnits = inv => Math.max(1, Math.ceil(Math.ceil(requiredFor(inv)) / inv.kw));
    const forcedUnits = Number(input.invUnits) > 0 ? Math.round(Number(input.invUnits)) : 0;

    // Candidates: the chosen model, or every model of the brand (any brand if none fits) whose
    // battery voltage works with this battery, at every unit count it can run in parallel
    const candidates = [];
    const fixed = input.inverterId && input.inverterId !== 'auto' ? findItem(catalog, 'inverters', input.inverterId) : null;
    if (fixed) candidates.push([fixed, forcedUnits || minUnits(fixed)]);
    else {
      const all = flat(catalog, 'inverters');
      const fits = i => battery ? (battery.chem === 'lithium' ? i.volt === battery.volt : i.volt % battery.volt === 0) : true;
      const brandPool = all.filter(i => (i.brand || '').toLowerCase() === (input.inverterBrand || '').toLowerCase() && fits(i));
      [brandPool, all.filter(fits), all].some(pool => {
        pool.forEach(inv => {
          const lo = forcedUnits || minUnits(inv);
          const hi = forcedUnits || (inv.parallel === 'yes' ? Math.max(lo, inv.maxParallel || 1) : lo);
          for (let u = lo; u <= hi; u++) candidates.push([inv, u]);
        });
        return pool.length > 0;
      });
    }
    if (!candidates.length) candidates.push([null, 1]);

    // Cheapest design that passes every check; otherwise the one with the fewest failures
    let best = null;
    for (const [inv, u] of candidates) {
      const d = build(inv, u);
      const fails = d.checks.filter(c => c.status === 'fail').length;
      if (!best || fails < best.fails || (fails === best.fails && d.total < best.d.total)) best = { d, fails };
      if (empty || fixed) break;
    }
    return best.d;

    function build(inverter, units) {
    const requiredKW = requiredFor(inverter);
    const requiredKWRounded = empty ? 0 : Math.ceil(requiredKW);
    const invEff = (inverter && inverter.eff) || 0.80;
    const sysV = (inverter && inverter.volt) || (battery && battery.volt) || 48;
    const dod = (battery && battery.dod) || 0.8;
    const bEff = battEfficiency(battery);
    const battAhNeeded = empty ? 0 : adjustedEnergyWh / (sysV * bEff * dod) * cfg.daysOfAutonomy;
    const bVolt = (battery && battery.volt) || sysV;
    const bAh = (battery && battery.ah) || 200;
    const series = Math.max(1, Math.round(sysV / bVolt));
    let strings = empty ? 0 : Math.ceil(battAhNeeded / bAh);
    if (battery && battery.chem !== 'lithium' && series === 1 && strings % 2) strings += 1; // sheet EVEN()
    const batteries = strings * series;
    const bankWh = batteries * bAh * bVolt;

    // ── Panels (sheet E37–J41, I54–I55, E96) ──────────────────────
    let solarNeededW = 0, panelsNeeded = 0, pvStrings = 0, panelsPerString = 0, numPanels = 0;
    if (withSolar && panel && !empty) {
      solarNeededW = bankWh * (1 + cfg.chargeLoss) / cfg.sunHours;             // I38 / I39
      panelsNeeded = Math.ceil(solarNeededW / panel.watt / cfg.panelEff);     // I40 / I41
      const perInv = panelsNeeded / units;
      const maxV = (inverter && inverter.pvMaxV) || 500;
      pvStrings = Math.max(1, Math.ceil((panel.voc || 50) * perInv / maxV));  // I55
      panelsPerString = Math.max(1, Math.floor(perInv / pvStrings));           // I54
      numPanels = panelsPerString * pvStrings * units;                         // E96
    }
    const panelW = numPanels * ((panel && panel.watt) || 0);
    const dailySolarWh = panelW * cfg.panelEff * cfg.sunHours;                 // D41

    // ── Data-sheet checks (sheet F50–F64) ─────────────────────────
    const checks = [];
    const add = (label, ok, detail, warn) => checks.push({ label, status: ok ? 'ok' : (warn ? 'warn' : 'fail'), detail });
    if (!empty && inverter) {
      const capKW = inverter.kw * units;
      add('Inverter capacity', capKW >= requiredKWRounded,
        `${units} × ${inverter.kw} kW = ${capKW} kW for a ${requiredKWRounded} kW requirement`);
      if (units > 1) {
        add('Parallel operation', inverter.parallel === 'yes' && units <= inverter.maxParallel,
          inverter.parallel === 'yes' ? `${units} units, up to ${inverter.maxParallel} allowed in parallel` : `${inverter.label} has no parallel function`);
      }
      add('Battery voltage', bVolt * series === inverter.volt,
        `${series > 1 ? series + ' × ' : ''}${bVolt}V battery bank on a ${inverter.volt}V inverter`);
      if (withSolar && panel && numPanels) {
        const perInvW = (panelsNeeded / units) * panel.watt;
        add('PV input power', perInvW <= inverter.pvInput * 1000,
          `${Math.round(perInvW).toLocaleString('en-NG')} W per inverter, max ${(inverter.pvInput * 1000).toLocaleString('en-NG')} W`);
        const stringV = panelsPerString * (panel.voc || 0);
        add('PV string voltage', stringV < inverter.pvMaxV,
          `${panelsPerString} panels × ${panel.voc} Voc = ${stringV.toFixed(0)} V, max ${inverter.pvMaxV} V`);
        const perMppt = Math.ceil(pvStrings / (inverter.mpptNo || 1));
        const amps = perMppt * (panel.isc || 0);
        add('PV input current', amps <= (inverter.mpptMaxA || 0) || !inverter.mpptMaxA,
          `${perMppt} string${perMppt > 1 ? 's' : ''} per MPPT × ${panel.isc} A = ${amps.toFixed(1)} A, max ${inverter.mpptMaxA} A`);
        add('Panel combiner', pvStrings <= 4, pvStrings <= 4 ? `${pvStrings} string${pvStrings > 1 ? 's' : ''} per inverter` : `${pvStrings} strings — more than a 4-to-1 MC4 can join, use more inverters`);
      }
    }
    const ready = checks.length > 0 && checks.every(c => c.status === 'ok');

    // ── Accessories bill of materials (sheet rows 72–93) ──────────
    const acc = {};
    flat(catalog, 'accessories').forEach(it => { if (it.key) acc[it.key] = it; });
    const bom = [];
    const line = (key, qty, note) => {
      if (!qty || qty <= 0) return;
      const it = acc[key];
      const unit = priceOf(it, field);
      bom.push({ key, label: it ? it.label : key, qty, unit, total: unit * qty, note: note || '' });
    };
    if (!empty && inverter) {
      const isec = (panel && panel.isc) || 0;
      if (withSolar && numPanels) {
        line('pvBreaker', units, nextBreaker(isec * pvStrings * 1.25) + 'A');
        line(units <= 4 ? 'dcSurge' : 'dcPanelBox', units);
      }
      const fourPole = inverter.phase === 3 || inverter.kw >= 8;
      const acQty = units === 1 ? 2 : (units > 4 ? 0 : 2 * units);
      line(fourPole ? 'acBreaker4p' : 'acBreaker2p', acQty, nextBreaker(inverter.kw * 1000 / (230 * 0.8)) + 'A');
      line(fourPole ? 'acSurge4p' : 'acSurge1p', units);
      if (units > 4) line('acPanelBox', 1);
      // Battery protection
      let breakerKey, breakerQty;
      if (units > 4 && inverter.parallel === 'yes') { breakerKey = 'busBarBox'; breakerQty = 1; }
      else if (battery && battery.chem === 'lithium') { breakerKey = bAh <= 100 ? 'mccb125' : 'mccb250'; breakerQty = batteries; }
      else { breakerKey = batteries < 4 ? 'dcBreaker60' : 'mccb125'; breakerQty = 1; }
      line(breakerKey, breakerQty);
      const sitesQty = units === 1 ? 1 : (units > 4 ? 0 : units);
      line(requiredKWRounded <= 7 ? 'bypass100' : 'bypass200', sitesQty);   // sheet F78 uses the required kW (E50)
      line('enclosure12', sitesQty);
      if (withSolar && numPanels && panel) {
        const bankKWh = Math.round(bankWh / 100) / 10;
        const cableM = (bankKWh <= 3 ? 40 : bankKWh <= 11 ? 50 : bankKWh <= 50 ? 65 : 100) + numPanels;
        line('solarCable6mm', cableM, 'metres');
        line(panel.watt <= 600 ? 'midClampLight' : 'midClampThick', numPanels * 2 + 4);
        line(panel.watt <= 600 ? 'lClamp' : 'endClampThick', numPanels + 2);
        line('mc4Single', (pvStrings + 2) * units);
        if (pvStrings >= 2) line(pvStrings === 2 ? 'mc4_2to1' : pvStrings === 3 ? 'mc4_3to1' : 'mc4_4to1', units);
        line(panel.watt <= 650 ? 'solarRail' : 'smRail34', numPanels + 2);
        line('flashBand', 1);
      }
      line('dcCable25mm', 4 * batteries, 'metres');
      if (breakerKey === 'mccb125' || breakerKey === 'mccb250') line('mccbBox', breakerQty);
      else if (breakerKey === 'dcBreaker60') line('box4way', 1);
      if (battery && battery.chem !== 'lithium' && batteries >= 2) {
        if (batteries === 2 || batteries === 6) line('rack2', batteries / 2);
        else line('rack4', Math.ceil(batteries / 4));
      }
      line('trunkPipe', inverter.kw <= 7 ? 3 : 5);
      line('cableLug', 4 * batteries);
    }

    // ── Costs (sheet rows 94–101) ────────────────────────────────
    const cInverter = empty ? 0 : priceOf(inverter, field) * units;
    const cPanels = empty ? 0 : priceOf(panel, field) * numPanels;
    const cBattery = empty ? 0 : priceOf(battery, field) * batteries;
    const cAccessories = bom.reduce((s, l) => s + l.total, 0);
    const cInstall = (cInverter + cPanels + cBattery) * cfg.installPct;      // I98 = 8% of the main equipment
    const cLogistics = empty ? 0 : (Number(cfg.logistics) || 0);
    const subtotal = cInverter + cPanels + cBattery + cAccessories + cInstall + cLogistics;
    const markupAmt = subtotal * (cfg.markupPct || 0);
    const total = subtotal + markupAmt;

    return {
      empty, loadW, energyWh, adjustedEnergyWh,
      requiredKW, requiredKWRounded, inverter, units, invEff,
      battery, battAhNeeded, batteries, batterySeries: series, batteryStrings: strings, bankWh, systemVoltage: sysV, dod, battEff: bEff,
      panel, solarNeededW, panelsNeeded, pvStrings, panelsPerString, numPanels, panelW, dailySolarWh,
      checks, ready, bom,
      cInverter, cPanels, cBattery, cAccessories, cInstall, cLogistics, markupAmt, total,
      cfg, autoSelected: !fixed
    };
    }
  }

  const api = { size, flat, findItem, pickInverter, battEfficiency };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SIQSizing = api;
})(typeof window !== 'undefined' ? window : this);
