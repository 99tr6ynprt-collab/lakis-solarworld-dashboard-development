/* LAKIS SOLARWORLD Dashboard
 * Dashboard UI
 * Version 1.5.9-beta.4
 *
 * Design:
 * - black / near-black background
 * - optional individual background image per tab
 * - stable settings controls (no rerender while selecting entities)
 * - live overview values
 */

class LakisSolarworldDashboard extends HTMLElement {
  constructor() {
    super();

    this._hass = null;
    this._entry = null;
    this._config = {};
    this._tab = "overview";
    this._loading = true;
    this._message = "";
    this._rendered = false;
    this._saveTimer = null;
    this._saveInFlight = false;
    this._savePromise = null;
    this._moduleSavePromise = null;
    this._moduleEventsAttached = false;
    this._dirty = false;
    this._fullscreenInitialized = false;
  }

  set hass(value) {
    this._hass = value;

    if (this._loading && value) {
      this._load();
      return;
    }

    if (this._tab !== "settings") {
      this._render();
    }
  }

  set panel(value) {
    const entryId = value?.config?.entry_id || value?.entry_id;
    if (entryId && entryId !== this._entry) {
      this._entry = entryId;
      this._load();
    }
  }

  setConfig(config) {
    if (config?.entry_id && config.entry_id !== this._entry) {
      this._entry = config.entry_id;
      this._load();
    }
  }

  async _load() {
    if (!this._hass || !this._entry) return;

    try {
      this._loading = true;

      const result = await this._hass.callWS({
        type: "lakis_solarworld_development/get_config",
        entry_id: this._entry,
      });

      this._config = result?.config || result || {};

      // Normalize legacy module storage (array = enabled module names)
      // to the object format used by the current dashboard.
      const moduleKeys = [
        "energy",
        "pv",
        "grid",
        "battery",
        "wallbox",
        "vehicle",
        "heatpump",
        "climate",
      ];
      const rawModules = this._config.modules;
      if (Array.isArray(rawModules)) {
        const modules = Object.fromEntries(moduleKeys.map((key) => [key, false]));
        rawModules.forEach((name) => {
          if (typeof name === "string" && moduleKeys.includes(name)) {
            modules[name] = true;
          }
        });
        this._config.modules = modules;
      } else if (!rawModules || typeof rawModules !== "object") {
        this._config.modules = Object.fromEntries(
          moduleKeys.map((key) => [key, true])
        );
      } else {
        this._config.modules = Object.fromEntries(
          moduleKeys.map((key) => [key, rawModules[key] !== false])
        );
      }

      this._config.backgrounds = {
        overview: "",
        pv: "",
        grid: "",
        battery: "",
        wallbox: "",
        heatpump: "",
        vehicle: "",
        settings: "",
        ...(this._config.backgrounds || {}),
      };

      this._loading = false;
      this._render();
    } catch (err) {
      console.error("LAKIS SOLARWORLD:", err);
      this._loading = false;
      this._message = "Konfiguration konnte nicht geladen werden.";
      this._render();
    }
  }

  _enabled(module) {
    const modules = this._config.modules || {};
    return modules[module] !== false;
  }

  _entity(key) {
    return this._config[key] || "";
  }

  _state(entityId) {
    if (!this._hass || !entityId) return null;
    return this._hass.states?.[entityId] || null;
  }

  _number(entityId) {
    const state = this._state(entityId);
    if (!state) return null;
    const value = Number(state.state);
    return Number.isFinite(value) ? value : null;
  }

  _powerNumber(entityId) {
    const state = this._state(entityId);
    if (!state) return null;
    const value = Number(state.state);
    if (!Number.isFinite(value)) return null;
    const unit = String(state.attributes?.unit_of_measurement || '').toLowerCase();
    return unit === 'kw' ? value * 1000 : value;
  }

  _batteryFlow() {
    const chargeEntity = this._entity("battery_charge_power");
    const dischargeEntity = this._entity("battery_discharge_power");
    const charge = this._powerNumber(chargeEntity);
    const discharge = this._powerNumber(dischargeEntity);

    if (chargeEntity || dischargeEntity) {
      const chargeW = charge !== null && charge > 0 ? charge : 0;
      const dischargeW = discharge !== null && discharge > 0 ? discharge : 0;
      if (chargeW > 0 && dischargeW <= 0) return { power: chargeW, label: "Laden", direction: "charge", color: "green" };
      if (dischargeW > 0 && chargeW <= 0) return { power: -dischargeW, label: "Entladen", direction: "discharge", color: "red" };
      if (chargeW > 0 && dischargeW > 0) {
        return chargeW >= dischargeW
          ? { power: chargeW, label: "Laden", direction: "charge", color: "green" }
          : { power: -dischargeW, label: "Entladen", direction: "discharge", color: "red" };
      }
      return { power: 0, label: "Standby", direction: "idle", color: "grey" };
    }

    const legacy = this._powerNumber(this._entity("battery_power"));
    if (legacy === null) return { power: null, label: "—", direction: "idle", color: "grey" };
    if (legacy > 5) return { power: legacy, label: "Laden", direction: "charge", color: "green" };
    if (legacy < -5) return { power: legacy, label: "Entladen", direction: "discharge", color: "red" };
    return { power: legacy, label: "Standby", direction: "idle", color: "grey" };
  }

  _formatPower(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return `${Math.round(value).toLocaleString("de-DE")} W`;
  }

  _formatPercent(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return `${Math.round(value)} %`;
  }

  _formatTemp(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return "—";
    }
    return `${value.toFixed(1).replace(".", ",")} °C`;
  }

  _domain(entityId) {
    if (!entityId || !entityId.includes(".")) return "";
    return entityId.split(".")[0];
  }

  _entityOptions(domains = []) {
    if (!this._hass?.states) return [];

    return Object.entries(this._hass.states)
      .filter(([id]) => !domains.length || domains.includes(this._domain(id)))
      .map(([id, state]) => ({
        id,
        name: state.attributes?.friendly_name || id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  _entitySelect(key, label, domains = [], description = "") {
    const current = this._entity(key);
    const entities = this._entityOptions(domains);

    return `
      <div class="entity-setting">
        <label>${this._escape(label)}</label>
        ${description ? `<div class="setting-description">${this._escape(description)}</div>` : ""}
        <select data-entity-key="${this._escape(key)}">
          <option value="">— Keine Entität —</option>
          ${entities.map((entity) => `
            <option
              value="${this._escape(entity.id)}"
              ${entity.id === current ? "selected" : ""}
            >
              ${this._escape(entity.name)} — ${this._escape(entity.id)}
            </option>
          `).join("")}
        </select>
      </div>
    `;
  }

  _checkbox(module, label, description = "") {
    const enabled = this._enabled(module);
    return `
      <div class="module-switch">
        <button
          type="button"
          class="switch-row"
          data-module="${this._escape(module)}"
          aria-pressed="${enabled ? "true" : "false"}"
          aria-label="${this._escape(label)}"
          title="${enabled ? "Modul deaktivieren" : "Modul aktivieren"}"
        >
          <span class="switch-box ${enabled ? "is-on" : ""}" aria-hidden="true"></span>
          <span class="switch-text">
            <strong>${this._escape(label)}</strong>
            <small>${this._escape(description)}</small>
          </span>
        </button>
      </div>
    `;
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _icon(type, size = 38) {
    const common = `width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true"`;
    const icons = {
      solar: `<svg ${common}><circle cx="32" cy="32" r="12" stroke="currentColor" stroke-width="4"/><path d="M32 4v10M32 50v10M4 32h10M50 32h10M12.2 12.2l7.1 7.1M44.7 44.7l7.1 7.1M51.8 12.2l-7.1 7.1M19.3 44.7l-7.1 7.1" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
      battery: `<svg ${common}><rect x="14" y="11" width="36" height="42" rx="6" stroke="currentColor" stroke-width="4"/><path d="M25 6h14" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><rect x="20" y="31" width="24" height="15" rx="3" fill="currentColor" opacity=".85"/><path d="M32 18l-5 9h6l-4 8 9-11h-6l4-6z" fill="#071018"/></svg>`,
      grid: `<svg ${common}><path d="M32 7v50M18 57l14-50 14 50M22 27h20M19 39h26M15 50h34" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 18h46" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>`,
      house: `<svg ${common}><path d="M8 30 32 9l24 21v24H8V30Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M25 54V38h14v16M18 29h.1M32 29h.1M46 29h.1" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
      car: `<svg ${common}><path d="M12 39l4-14c1-4 4-6 8-6h16c4 0 7 2 8 6l4 14v10H12V39Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M18 30h28M18 49v5M46 49v5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="21" cy="43" r="3" fill="currentColor"/><circle cx="43" cy="43" r="3" fill="currentColor"/></svg>`,
      heat: `<svg ${common}><path d="M32 57c-11 0-18-7-18-17 0-8 5-14 11-20 1 6 5 9 7 10 2-7 4-13 1-22 10 7 17 17 17 29 0 12-8 20-18 20Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M32 49c-5 0-8-3-8-7 0-3 2-6 5-9 0 4 2 5 3 6 2-3 2-6 2-9 4 4 6 8 6 13 0 4-3 6-8 6Z" fill="currentColor" opacity=".8"/></svg>`,
      climate: `<svg ${common}><rect x="11" y="17" width="42" height="28" rx="6" stroke="currentColor" stroke-width="4"/><path d="M19 28h26M19 35h18M23 49h18M32 12v5" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M42 39c3 2 4 4 4 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
      bolt: `<svg ${common}><path d="M37 4 14 34h15l-2 26 23-33H35l2-23Z" fill="currentColor"/></svg>`,
    };
    return icons[type] || icons.bolt;
  }

  _tileStyle(screen) {
    const url = this._backgroundFor(screen);
    return url ? `style="--tile-bg:url('${this._escape(url)}')"` : "";
  }

  _detailStyle(screen) {
    const url = this._backgroundFor(screen);
    return url ? `style="background-image:linear-gradient(120deg,rgba(0,0,0,.82),rgba(0,8,15,.48)),url('${this._escape(url)}');background-size:cover;background-position:center;"` : "";
  }

  _defaultBackground(tab) {
    const defaults = {
      overview: "/api/lakis_solarworld_development/static/defaults/overview.jpg",
      pv: "/api/lakis_solarworld_development/static/defaults/pv.jpg",
      battery: "/api/lakis_solarworld_development/static/defaults/battery.jpg",
      wallbox: "/api/lakis_solarworld_development/static/defaults/wallbox.jpg",
      heatpump: "/api/lakis_solarworld_development/static/defaults/heatpump.jpg",
      climate: "/api/lakis_solarworld_development/static/defaults/climate.jpg",
    };
    return defaults[tab] || "";
  }

  _backgroundFor(tab = this._tab) {
    return this._config.backgrounds?.[tab] || this._defaultBackground(tab);
  }

  _hasCustomBackground(tab) {
    return Boolean(this._config.backgrounds?.[tab]);
  }

  _render() {
    if (!this._hass) return;

    const bg = this._backgroundFor();

    this.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100vh;
          width: 100%;
        }

        :host(.fullscreen-sidebar) {
          width: calc(100% + var(--lakis-sidebar-offset, 0px)) !important;
          margin-left: calc(0px - var(--lakis-sidebar-offset, 0px)) !important;
          position: relative;
          z-index: 1;
        }

        * { box-sizing: border-box; }

        .app {
          min-height: 100vh;
          width: 100%;
          padding: 24px;
          position: relative;
          overflow: hidden;
          background:
            linear-gradient(
              rgba(0,0,0,.38),
              rgba(0,0,0,.58)
            ),
            ${bg ? `url("${this._escape(bg)}")` : "none"};
          background-size: cover;
          background-position: center;
          background-attachment: fixed;
        }

        .app::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(
              circle at 50% 0%,
              rgba(0,120,190,.12),
              transparent 48%
            );
        }

        .header {
          position: relative;
          min-height: 88px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          margin-bottom: 18px;
        }

        .brand {
          grid-column: 2;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
        }

        .brand-logo {
          width: 72px;
          height: 72px;
          object-fit: contain;
          filter: drop-shadow(0 0 16px rgba(112,80,255,.55));
        }

        .brand-title {
          font-size: 28px;
          font-weight: 800;
          letter-spacing: .5px;
          white-space: nowrap;
        }

        .brand-subtitle {
          margin-top: 4px;
          color: #e8f2f8;
          font-size: 13px;
          text-align: center;
        }

        .clock {
          grid-column: 3;
          justify-self: end;
          color: #8ca6bd;
          font-size: 13px;
          line-height: 1.45;
          text-align: right;
        }

        .tabs {
          position: relative;
          display: flex;
          justify-content: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }

        .tab {
          border: 1px solid rgba(0,175,255,.35);
          background: rgba(5,14,22,.82);
          color: #9ab1c7;
          padding: 11px 18px;
          border-radius: 13px;
          cursor: pointer;
          font-size: 14px;
          transition: .2s;
        }

        .tab:hover,
        .tab.active {
          color: #fff;
          border-color: #00aaff;
          background: rgba(0,130,210,.2);
          box-shadow:
            0 0 16px rgba(0,160,255,.22),
            inset 0 0 16px rgba(0,160,255,.05);
        }

        .dashboard-grid {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 2.2fr) minmax(280px, .9fr);
          gap: 16px;
        }

        .flow-card,
        .card,
        .settings-card,
        .side-card {
          background:
            linear-gradient(
              145deg,
              rgba(4,12,19,.08),
              rgba(0,0,0,.04)
            );
          border: 1px solid rgba(0,170,255,.32);
          border-radius: 20px;
          box-shadow:
            0 18px 60px rgba(0,0,0,.4),
            inset 0 1px 0 rgba(255,255,255,.025);
          backdrop-filter: blur(10px);
        }

        .flow-card {
          padding: 20px;
          min-height: 400px;
        }

        .section-title {
          display:flex; align-items:center; gap:8px;
          font-size: 17px;
          font-weight: 800;
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          text-shadow: 0 0 10px rgba(255,255,255,.14);
          margin-bottom: 18px;
        }

        .flow {
          position: relative;
          min-height: 365px;
          display: grid;
          grid-template-columns: 1fr 1.15fr 1fr;
          grid-template-rows: 1fr 1fr 1fr;
          gap: 14px 18px;
          align-items: center;
        }

        .flow-arrows {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          overflow: visible;
          z-index: 1;
        }
        .flow-line {
          fill: none;
          stroke-width: 2.6;
          stroke-linecap: round;
          stroke-dasharray: 7 8;
          opacity: 0;
        }
        .flow-line.green { 
          stroke: #36f28b;
          filter: drop-shadow(0 0 4px rgba(54,242,139,.8));
        }
        .flow-line.red {
          stroke: #ff4652;
          filter: drop-shadow(0 0 5px rgba(255,70,82,.85));
        }
        .flow-line.active {
          opacity: 1;
          animation: lakis-flow 0.95s linear infinite;
        }
        .flow-line.inactive {
          opacity: .08;
          stroke: #5a6670;
          filter: none;
          animation: none;
        }
        .battery-state-green .energy-icon, .battery-state-green .tile-icon { color:#47ff74; filter:drop-shadow(0 0 10px rgba(71,255,116,.65)); }
        .battery-state-red .energy-icon, .battery-state-red .tile-icon { color:#ff4d5a; filter:drop-shadow(0 0 10px rgba(255,77,90,.55)); }
        .battery-state-green { border-color:rgba(71,255,116,.72) !important; }
        .battery-state-red { border-color:rgba(255,77,90,.72) !important; }
        .flow-arrowhead.green {
          fill: #36f28b;
          filter: drop-shadow(0 0 5px rgba(54,242,139,.9));
        }
        .flow-arrowhead.red {
          fill: #ff4652;
          filter: drop-shadow(0 0 6px rgba(255,70,82,.95));
        }
        @keyframes lakis-flow {
          to { stroke-dashoffset: -44; }
        }
        .flow > .energy-node {
          position: relative;
          z-index: 2;
        }

        .energy-node {
          min-height: 105px;
          padding: 14px;
          border-radius: 17px;
          background: rgba(2,8,13,.18);
          border: 1px solid rgba(0,170,255,.42);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          box-shadow: 0 0 20px rgba(0,130,220,.05);
        }

        .energy-icon { width:42px; height:42px; display:flex; align-items:center; justify-content:center; margin-bottom:7px; color:#fff; }
        .energy-icon svg { width:100%; height:100%; }
        .visual-node { overflow:hidden; position:relative; }
        .visual-node::before { content:""; position:absolute; inset:0; background:linear-gradient(90deg,rgba(0,0,0,.46),rgba(0,0,0,.18)),var(--tile-bg) center/cover no-repeat; opacity:.9; z-index:0; }
        .visual-node > * { position:relative; z-index:1; }
        .energy-name { color: #ffffff; font-size: 12px; margin-bottom: 4px; }
        .energy-value { font-size: 20px; font-weight: 800; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-shadow: 0 0 10px rgba(255,255,255,.18); }

        .pv {
          border-color: rgba(45,230,130,.7);
          box-shadow: 0 0 24px rgba(45,230,130,.08);
        }

        .grid {
          border-color: rgba(255,70,80,.65);
        }

        .battery {
          border-color: rgba(70,145,255,.7);
        }

        .house {
          grid-column: 2;
          grid-row: 2;
          min-height: 132px;
        }

        .pv-node { grid-column: 2; grid-row: 1; }
        .grid-node { grid-column: 2; grid-row: 3; }
        .battery-node { grid-column: 1; grid-row: 2; }
        .wallbox-node { grid-column: 3; grid-row: 2; }

        .side-column {
          display: grid;
          gap: 12px;
          align-content: start;
        }

        .side-card {
          min-height: 105px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 14px;
          position: relative;
          overflow: hidden;
        }
        .side-card::before, .visual-tile::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: var(--tile-bg);
          background-size: cover;
          background-position: center;
          opacity: .58;
          filter: saturate(1.05);
        }
        .side-card::after, .visual-tile::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg,rgba(0,0,0,.28),rgba(0,0,0,.10));
        }
        .side-card > *, .visual-tile > * { position: relative; z-index: 2; }
        .overview-shell {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0,2.35fr) minmax(280px,.82fr);
          gap: 16px;
        }
        .overview-main { min-width: 0; }
        .status-panel {
          display: grid;
          gap: 12px;
          align-content: start;
        }
        .status-card {
          padding: 18px;
          border-radius: 20px;
          background: linear-gradient(145deg,rgba(4,12,19,.18),rgba(0,0,0,.12));
          border: 1px solid rgba(0,170,255,.30);
          box-shadow: 0 18px 55px rgba(0,0,0,.38);
          backdrop-filter: blur(10px);
        }
        .status-title { font-size: 15px; font-weight: 850; color:#fff; margin-bottom:12px; }
        .status-row { display:grid; grid-template-columns:24px 1fr auto; gap:9px; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,.06); }
        .status-row:last-child { border-bottom:0; }
        .status-dot { width:10px; height:10px; border-radius:50%; background:#42ef91; box-shadow:0 0 10px rgba(66,239,145,.8); }
        .status-label { color:#dce9f1; font-size:12px; }
        .status-value { color:#65efaa; font-size:12px; font-weight:800; }
        .visual-tiles {
          display:grid;
          grid-template-columns:repeat(5,minmax(0,1fr));
          gap:20px;
          margin-top:14px;
        }
        .visual-tile {
          cursor:pointer;
          min-height:185px;
          position:relative;
          overflow:hidden;
          border-radius:18px;
          border:1px solid rgba(0,170,255,.30);
          background:linear-gradient(145deg,rgba(4,12,19,.16),rgba(0,0,0,.10));
          box-shadow:0 15px 45px rgba(0,0,0,.36);
          padding:16px;
          display:flex;
          flex-direction:column;
          justify-content:flex-end;
        }
        .tile-icon { width:42px; height:42px; color:#fff; margin-bottom:auto; filter:drop-shadow(0 0 8px rgba(0,180,255,.35)); }
        .tile-title { color:#fff; font-size:14px; font-weight:800; }
        .tile-value { color:#fff; font-size:25px; font-weight:900; margin-top:6px; text-shadow:0 0 12px rgba(255,255,255,.2); }
        .tile-meta { color:#d7e6ef; font-size:11px; margin-top:3px; }
        .overview-note { color:#b9cbd6; font-size:11px; margin-top:10px; }
        .flow-card { position:relative; overflow:hidden; }
        .flow-card::before {
          content:"";
          position:absolute;
          width:min(62%,560px);
          aspect-ratio:2 / 1;
          left:50%;
          top:53%;
          transform:translate(-50%,-50%);
          background:url("/api/lakis_solarworld_development/static/lakis_logo_transparent.png") center/contain no-repeat;
          opacity:.12;
          filter:drop-shadow(0 0 24px rgba(94,67,255,.35));
          pointer-events:none;
          z-index:0;
        }
        .flow-card::after { content:""; position:absolute; inset:0; pointer-events:none; background:radial-gradient(circle at 50% 50%,rgba(0,160,255,.08),transparent 55%); z-index:1; }
        .flow-card > * { position:relative; z-index:2; }
        .flow-card > * { position:relative; z-index:2; }

        .side-icon { font-size: 30px; }
        .side-name { color: #ffffff; font-size: 12px; }
        .side-value { font-size: 21px; font-weight: 800; margin-top: 4px; color: #ffffff !important; -webkit-text-fill-color: #ffffff !important; text-shadow: 0 0 10px rgba(255,255,255,.18); }

        .summary {
          position: relative;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
          margin-top: 16px;
        }

        .summary .card {
          padding: 17px;
        }

        .card-label {
          color: #e1edf5;
          font-size: 11px;
          margin-bottom: 7px;
        }

        .card-value {
          font-size: 21px;
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          text-shadow: 0 0 10px rgba(255,255,255,.18);
          font-weight: 800;
        }

        .detail-page {
          position: relative;
          min-height: 560px;
          display: flex;
          align-items: stretch;
        }
        .detail-hero {
          width: 100%;
          min-height: 560px;
          padding: 44px;
          display: grid;
          grid-template-columns: 1.15fr .85fr;
          gap: 28px;
          align-items: center;
          background: linear-gradient(120deg, rgba(0,0,0,.78), rgba(0,8,15,.48));
          border: 1px solid rgba(0,175,255,.38);
          border-radius: 24px;
          box-shadow: 0 20px 80px rgba(0,0,0,.5), inset 0 0 50px rgba(0,130,220,.05);
          backdrop-filter: blur(5px);
        }
        .detail-icon { font-size: 76px; margin-bottom: 12px; }
        .detail-title {
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          font-size: 34px;
          font-weight: 850;
          margin-bottom: 8px;
        }
        .detail-subtitle {
          color: #e5f0f6 !important;
          font-size: 15px;
          margin-bottom: 28px;
        }
        .detail-value {
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          font-size: clamp(48px, 7vw, 86px);
          font-weight: 900;
          line-height: 1;
          text-shadow: 0 0 24px rgba(255,255,255,.2);
        }
        .detail-meta {
          color: #d9e8f1 !important;
          font-size: 17px;
          margin-top: 16px;
        }
        .detail-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0,1fr));
          gap: 14px;
        }
        .detail-metric {
          padding: 20px;
          min-height: 110px;
          border-radius: 17px;
          background: rgba(0,0,0,.48);
          border: 1px solid rgba(0,175,255,.3);
        }
        .detail-metric-label { color: #dce9f1 !important; font-size: 12px; margin-bottom: 8px; }
        .detail-metric-value { color: #ffffff !important; -webkit-text-fill-color:#ffffff !important; font-size: 25px; font-weight: 850; }

        .settings-grid {
          position: relative;
          display: grid;
          grid-template-columns: minmax(280px,.85fr) minmax(0,1.15fr);
          gap: 16px;
        }

        .settings-card {
          padding: 21px;
        }

        .settings-card.full {
          grid-column: 1 / -1;
        }

        .settings-card h3 {
          margin: 0 0 6px;
          font-size: 18px;
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
        }

        .settings-card > p {
          margin: 0 0 18px;
          color: #e7f1f7 !important;
          -webkit-text-fill-color: #e7f1f7 !important;
          font-size: 13px;
        }

        .module-switch {
          border-bottom: 1px solid rgba(100,150,190,.1);
        }

.switch-row {
          display: flex;
          align-items: center;
          gap: 13px;
          width: 100%;
          padding: 13px 0;
          cursor: pointer;
          border: 0;
          background: transparent;
          color: inherit;
          text-align: left;
          font: inherit;
          appearance: none;
          -webkit-appearance: none;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          pointer-events: auto;
          transition: transform .12s ease, filter .12s ease;
        }
        .switch-row:hover {
          filter: brightness(1.08);
        }
        .switch-row:active {
          transform: scale(.985);
          filter: brightness(1.16);
        }

        .switch-box {
          width: 44px;
          height: 24px;
          border-radius: 20px;
          background: #182530;
          position: relative;
          flex: 0 0 auto;
          transition: .2s;
        }

        .switch-box::after {
          content: "";
          position: absolute;
          width: 18px;
          height: 18px;
          top: 3px;
          left: 3px;
          border-radius: 50%;
          background: #7f94a5;
          transition: .2s;
        }

        .switch-box.is-on {
          background: #00aef3;
          box-shadow: 0 0 16px rgba(0,174,243,.4);
        }

        .switch-box.is-on::after {
          left: 23px;
          background: #fff;
        }

        .switch-text {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .switch-text small {
          color: #d0dee8;
          font-size: 11px;
        }

        .entity-setting {
          margin-bottom: 17px;
        }

        .entity-setting label {
          display: block;
          margin-bottom: 7px;
          color: #c8d5df;
          font-size: 13px;
          font-weight: 700;
        }

        .setting-description {
          color: #dce9f1 !important;
          -webkit-text-fill-color: #dce9f1 !important;
          font-size: 11px;
          margin-bottom: 7px;
        }

        select,
        input[type="text"] {
          width: 100%;
          min-height: 44px;
          border-radius: 11px;
          border: 1px solid rgba(0,170,255,.45);
          background: #030a10;
          color: #fff;
          padding: 10px 12px;
          outline: none;
          font-size: 13px;
        }

        select:focus,
        input:focus {
          border-color: #00b7ff;
          box-shadow: 0 0 0 2px rgba(0,180,255,.12);
        }

        .background-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0,1fr));
          gap: 12px;
        }

        .background-item {
          padding: 14px;
          border: 1px solid rgba(0,170,255,.22);
          border-radius: 15px;
          background: rgba(0,0,0,.4);
        }

        .background-item strong {
          display: block;
          margin-bottom: 9px;
          color: #ffffff !important;
          -webkit-text-fill-color: #ffffff !important;
          font-size: 14px;
        }

        .background-preview {
          height: 110px;
          border-radius: 11px;
          background: #000 center/cover no-repeat;
          border: 1px solid rgba(0,170,255,.2);
          margin-bottom: 10px;
        }

        .upload-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .button,
        .save-button {
          border: 1px solid rgba(0,180,255,.55);
          border-radius: 11px;
          padding: 10px 14px;
          color: #fff;
          background: rgba(0,120,190,.18);
          cursor: pointer;
          font-weight: 700;
        }

        .save-button {
          background: linear-gradient(135deg,#007ec7,#00b9f3);
          box-shadow: 0 8px 24px rgba(0,160,230,.2);
        }

        .button:hover,
        .save-button:hover {
          filter: brightness(1.12);
        }

        .upload-input {
          display: none;
        }

        .message {
          color: #6ce3a1;
          font-size: 13px;
          margin-bottom: 10px;
        }

        .empty {
          position: relative;
          padding: 50px 20px;
          text-align: center;
          color: #7890a6;
        }

        .footer {
          position: relative;
          text-align: center;
          color: #9fb5c5;
          font-size: 10px;
          padding: 18px 0 4px;
        }

        @media (max-width: 1000px) {
          .dashboard-grid,
          .overview-shell,
          .settings-grid,
          .detail-hero {
            grid-template-columns: 1fr;
          }

          .summary {
            grid-template-columns: repeat(2,1fr);
          }
          .visual-tiles { grid-template-columns:repeat(3,minmax(0,1fr)); }

          .settings-card.full {
            grid-column: auto;
          }
        }

        @media (max-width: 700px) {
          .app { padding: 12px; }

          .header {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .brand {
            grid-column: 1;
            flex-direction: column;
          }

          .brand-title {
            font-size: 22px;
            white-space: normal;
            text-align: center;
          }

          .header-weather {
            grid-column: 1;
            justify-self: center;
          }
          .header-clock-row {
            grid-template-columns: 1fr;
            margin-top: 0;
          }
          .header-clock-row .clock {
            grid-column: 1;
            justify-self: center;
            text-align: center;
          }

          .flow {
            grid-template-columns: 1fr 1fr;
            grid-template-rows: auto auto auto;
            min-height: 420px;
          }

          .house {
            grid-column: 1 / span 2;
            grid-row: 2;
          }

          .pv-node { grid-column: 1; grid-row: 1; }
          .grid-node { grid-column: 2; grid-row: 1; }
          .battery-node { grid-column: 1; grid-row: 3; }
          .wallbox-node { grid-column: 2; grid-row: 3; }

          .background-grid {
            grid-template-columns: 1fr;
          }
          .visual-tiles { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .detail-hero {
            min-height: 500px;
            padding: 26px;
          }
          .detail-value { font-size: 52px; }
          .visual-tiles { grid-template-columns:1fr; }
        }
      </style>

      <div class="app">
        ${this._renderHeader()}
        ${this._renderTabs()}
        ${this._renderContent()}
        ${this._renderFooter()}
      </div>
    `;

    this._attachEvents();
    this._rendered = true;

    if (!this._fullscreenInitialized) {
      this._fullscreenInitialized = true;
      setTimeout(() => this._hideHASidebar(), 80);
    }
  }

  _renderHeader() {
    const now = new Date();
    const date = now.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const time = now.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return `
      ${(() => {
        const weather = this._state(this._entity("weather_entity"));
        const temperature = weather?.attributes?.temperature;
        const place = this._hass?.config?.location_name || "";
        return `
          <div class="header">
            <div></div>

            <div class="brand">
              <img
                class="brand-logo"
                src="/api/lakis_solarworld_development/static/lakis_mark.png"
                alt="LAKIS SOLARWORLD ENTWICKLUNG"
              />
              <div>
                <div class="brand-title">LAKIS SOLARWORLD ENTWICKLUNG</div>
                <div class="brand-subtitle">Lass die Sonne in dein Herz</div>
              </div>
            </div>

            <div class="header-weather">
              <div class="weather-icon">${this._icon("solar",34)}</div>
              <div>
                <div class="weather-temp">${temperature !== undefined && temperature !== null ? this._formatTemp(Number(temperature)) : "—"}</div>
                <div class="weather-place">${this._escape(place)}</div>
              </div>
            </div>
          </div>
        `;
      })()}

      <div class="header-clock-row">
        <div></div>
        <div></div>
        <div class="clock">
          ${this._escape(date)}<br>
          ${this._escape(time)} Uhr
        </div>
      </div>
    `;
  }

  _renderTabs() {
    const tabs = [
      ["overview", "Übersicht", true],
      ["pv", "PV", this._enabled("pv")],
      ["grid", "Netz", this._enabled("grid")],
      ["battery", "Batterie", this._enabled("battery")],
      ["wallbox", "Wallbox", this._enabled("wallbox")],
      ["heatpump", "Wärmepumpe", this._enabled("heatpump")],
      ["vehicle", this._config.vehicle_name || "Fahrzeug", this._enabled("vehicle")],
      ["climate", "Klimaanlagen", this._enabled("climate")],
      ["settings", "⚙ Einstellungen", true],
    ];

    return `
      <div class="tabs">
        ${tabs.filter(([, , enabled]) => enabled).map(([id, label]) => `
          <button
            class="tab ${this._tab === id ? "active" : ""}"
            data-tab="${id}"
          >${label}</button>
        `).join("")}
      </div>
    `;
  }

  _renderContent() {
    if (this._loading) {
      return `<div class="empty">Dashboard wird geladen …</div>`;
    }

    if (this._tab === "settings") {
      return this._renderSettings();
    }

    if (this._tab === "pv") return this._renderPV();
    if (this._tab === "grid") return this._renderGrid();
    if (this._tab === "battery") return this._renderBattery();
    if (this._tab === "wallbox") return this._renderWallbox();
    if (this._tab === "heatpump") return this._renderHeatpump();
    if (this._tab === "vehicle") return this._renderVehicle();
    if (this._tab === "climate") return this._renderClimate();

    return this._renderOverview();
  }

  _flowClass(active, color = "green") {
    return active ? `flow-line ${color} active` : "flow-line inactive";
  }

  _renderFlowArrows(pv, grid, batteryFlow, wallbox) {
    const threshold = 5;
    const pvToHouse = pv !== null && pv > threshold;
    const gridToHouse = grid !== null && grid > threshold;
    const houseToGrid = grid !== null && grid < -threshold;
    const batteryToHouse = batteryFlow.direction === "discharge" && Math.abs(batteryFlow.power || 0) > threshold;
    const houseToBattery = batteryFlow.direction === "charge" && Math.abs(batteryFlow.power || 0) > threshold;
    const houseToWallbox = wallbox !== null && wallbox > threshold && this._enabled("wallbox");

    return `
      <svg class="flow-arrows" viewBox="0 0 1000 365" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <marker id="lakis-arrow-green" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L8,4 L0,8 z" class="flow-arrowhead green"></path>
          </marker>
          <marker id="lakis-arrow-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L8,4 L0,8 z" class="flow-arrowhead red"></path>
          </marker>
        </defs>
        <path class="${this._flowClass(pvToHouse, "green")}" marker-end="url(#lakis-arrow-green)" d="M500 103 C500 122 500 137 500 153"></path>
        <path class="${this._flowClass(batteryToHouse, "green")}" marker-end="url(#lakis-arrow-green)" d="M330 182 C385 182 414 182 454 182"></path>
        <path class="${this._flowClass(houseToBattery, "green")}" marker-end="url(#lakis-arrow-green)" d="M454 198 C414 198 385 198 330 198"></path>
        <path class="${this._flowClass(houseToWallbox, "green")}" marker-end="url(#lakis-arrow-green)" d="M546 182 C590 182 620 182 670 182"></path>
        <path class="${this._flowClass(gridToHouse, "red")}" marker-end="url(#lakis-arrow-red)" d="M500 307 C500 285 500 264 500 240"></path>
        <path class="${this._flowClass(houseToGrid, "green")}" marker-end="url(#lakis-arrow-green)" d="M500 240 C500 264 500 285 500 307"></path>
      </svg>
    `;
  }

  _renderOverview() {
    const pv = this._powerNumber(this._entity("pv_power"));
    const house = this._powerNumber(this._entity("house_power"));
    const grid = this._powerNumber(this._entity("grid_power"));
    const batteryFlow = this._batteryFlow();
    const battery = batteryFlow.power;
    const soc = this._number(this._entity("battery_soc"));
    const wallbox = this._powerNumber(this._entity("wallbox_power"));
    const heatpump = this._number(this._entity("heatpump_power"));
    const vehicle = this._number(this._entity("vehicle_charging_power"));
    const climate = this._state(this._entity("climate_1"));
    const climateTemp = climate?.attributes?.current_temperature;
    const gridLabel = grid === null ? "—" : (grid < 0 ? "Einspeisung" : "Bezug");
    const batteryLabel = batteryFlow.label;

    return `
      <div class="overview-shell">
        <div class="overview-main">
          <div class="flow-card">
            <div class="section-title">${this._icon("bolt",22)} <span>Aktueller Energiefluss</span></div>
            <div class="flow">
              ${this._renderFlowArrows(pv, grid, batteryFlow, wallbox)}
              <div class="energy-node pv pv-node visual-node" style="--tile-bg:url('${this._escape(this._backgroundFor("pv"))}')">
                <div class="energy-icon">${this._icon("solar",40)}</div>
                <div class="energy-name">PV</div>
                <div class="energy-value">${this._formatPower(pv)}</div>
              </div>
              <div class="energy-node grid grid-node visual-node" style="--tile-bg:url('${this._escape(this._backgroundFor("grid"))}')">
                <div class="energy-icon">${this._icon("grid",40)}</div>
                <div class="energy-name">Netz</div>
                <div class="energy-value">${this._formatPower(grid)}</div>
              </div>
              <div class="energy-node house">
                <div class="energy-icon">${this._icon("house",44)}</div>
                <div class="energy-name">Haus</div>
                <div class="energy-value">${this._formatPower(house)}</div>
                <div class="energy-name">Verbrauch</div>
              </div>
              <div class="energy-node battery battery-node visual-node battery-state-${batteryFlow.color}" style="--tile-bg:url('${this._escape(this._backgroundFor("battery"))}')">
                <div class="energy-icon">${this._icon("battery",40)}</div>
                <div class="energy-name">Batterie</div>
                <div class="energy-value">${this._formatPercent(soc)}</div>
                <div class="energy-name">${this._formatPower(battery)} · ${batteryLabel}</div>
              </div>
              <div class="energy-node wallbox-node visual-node" style="--tile-bg:url('${this._escape(this._backgroundFor("wallbox"))}')">
                <div class="energy-icon">${this._icon("car",40)}</div>
                <div class="energy-name">Wallbox</div>
                <div class="energy-value">${this._enabled("wallbox") ? this._formatPower(wallbox) : "deaktiviert"}</div>
                <div class="energy-name">${this._enabled("wallbox") ? "Ladeleistung" : ""}</div>
              </div>
            </div>
          </div>
          <div class="summary">
            <div class="card"><div class="card-label">PV-Leistung</div><div class="card-value">${this._formatPower(pv)}</div></div>
            <div class="card"><div class="card-label">Hausverbrauch</div><div class="card-value">${this._formatPower(house)}</div></div>
            <div class="card"><div class="card-label">Netz</div><div class="card-value">${this._formatPower(grid)}</div></div>
            <div class="card"><div class="card-label">Batterie SOC</div><div class="card-value">${this._formatPercent(soc)}</div></div>
          </div>
        </div>

        <div class="status-panel">
          <div class="status-card">
            <div class="status-title">Tages-/Anlagenwerte</div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">PV aktuell</span><span class="status-value">${this._formatPower(pv)}</span></div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">Hausverbrauch</span><span class="status-value">${this._formatPower(house)}</span></div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">Batterie</span><span class="status-value">${this._formatPercent(soc)}</span></div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">Netz</span><span class="status-value">${gridLabel}</span></div>
          </div>
          <div class="status-card">
            <div class="status-title">Aktueller Status</div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">PV-Anlage</span><span class="status-value">${pv !== null ? "Aktiv" : "—"}</span></div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">Batterie</span><span class="status-value">${batteryLabel}</span></div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">Wallbox</span><span class="status-value">${this._enabled("wallbox") ? (wallbox !== null && wallbox > 5 ? "Lädt" : "Bereit") : "Aus"}</span></div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">Wärmepumpe</span><span class="status-value">${this._enabled("heatpump") ? (heatpump !== null ? "Aktiv" : "Bereit") : "Aus"}</span></div>
            <div class="status-row"><span class="status-dot"></span><span class="status-label">Klima</span><span class="status-value">${climate ? this._escape(climate.state) : (climateTemp != null ? "Aktiv" : "—")}</span></div>
          </div>
        </div>
      </div>

      <div class="visual-tiles">
        <div class="visual-tile" ${this._tileStyle("pv")} data-tile-tab="pv">
          <div class="tile-icon">${this._icon("solar",44)}</div><div class="tile-title">PV-Anlage</div><div class="tile-value">${this._formatPower(pv)}</div><div class="tile-meta">Aktuelle Leistung</div>
        </div>
        <div class="visual-tile battery-state-${batteryFlow.color}" ${this._tileStyle("battery")} data-tile-tab="battery">
          <div class="tile-icon">${this._icon("battery",44)}</div><div class="tile-title">Batterie</div><div class="tile-value">${this._formatPercent(soc)}</div><div class="tile-meta">${this._formatPower(battery)} · ${batteryLabel}</div>
        </div>
        ${this._enabled("wallbox") ? `<div class="visual-tile" ${this._tileStyle("wallbox")} data-tile-tab="wallbox"><div class="tile-icon">${this._icon("car",44)}</div><div class="tile-title">Wallbox / Fahrzeug</div><div class="tile-value">${this._formatPower(wallbox)}</div><div class="tile-meta">Ladeleistung · Fahrzeug ${this._formatPercent(this._number(this._entity("vehicle_soc")))}</div></div>` : ""}
        ${this._enabled("heatpump") ? `<div class="visual-tile" ${this._tileStyle("heatpump")} data-tile-tab="heatpump"><div class="tile-icon">${this._icon("heat",44)}</div><div class="tile-title">Wärmepumpe</div><div class="tile-value">${this._formatPower(heatpump)}</div><div class="tile-meta">Aktuelle Leistung</div></div>` : ""}
        ${this._enabled("climate") ? `<div class="visual-tile" ${this._tileStyle("climate")} data-tile-tab="climate"><div class="tile-icon">${this._icon("climate",44)}</div><div class="tile-title">Klimaanlagen</div><div class="tile-value">${climateTemp != null ? this._formatTemp(Number(climateTemp)) : "—"}</div><div class="tile-meta">${climate ? this._escape(climate.state) : "Keine Klima-Entität"}</div></div>` : ""}
      </div>
      <div class="overview-note">Die Hintergrundbilder der Kacheln entsprechen den jeweiligen Dashboard-Seiten und werden unter Einstellungen hochgeladen.</div>
    `;
  }

  _renderPV() {
    const pv = this._number(this._entity("pv_power"));
    return `
      <div class="detail-page">
        <div class="detail-hero" ${this._detailStyle("pv")}>
          <div>
            <div class="detail-icon">${this._icon("solar",76)}</div>
            <div class="detail-title">Photovoltaik</div>
            <div class="detail-subtitle">Aktuelle PV-Leistung</div>
            <div class="detail-value">${this._formatPower(pv)}</div>
          </div>
          <div class="detail-grid">
            <div class="detail-metric"><div class="detail-metric-label">PV-Leistung</div><div class="detail-metric-value">${this._formatPower(pv)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Entität</div><div class="detail-metric-value">${this._escape(this._entity("pv_power") || "—")}</div></div>
          </div>
        </div>
      </div>
      <div class="settings-card" style="margin-top:14px;">
        <h3>PV-Einstellung</h3>
        <p>Aktuelle PV-Leistung</p>
        <div class="card-value">${this._formatPower(pv)}</div>
        <br>
        ${this._entitySelect("pv_power", "PV-Leistungsentität", ["sensor"], "Aktuelle PV-Leistung in Watt.")}
      </div>
    `;
  }

  _renderGrid() {
    const grid = this._powerNumber(this._entity("grid_power"));
    return `
      <div class="detail-page">
        <div class="detail-hero" ${this._detailStyle("grid")}>
          <div>
            <div class="detail-icon">${this._icon("grid",76)}</div>
            <div class="detail-title">Netz</div>
            <div class="detail-subtitle">Netzbezug bzw. Einspeisung</div>
            <div class="detail-value">${this._formatPower(grid)}</div>
          </div>
          <div class="detail-grid">
            <div class="detail-metric"><div class="detail-metric-label">Leistung</div><div class="detail-metric-value">${this._formatPower(grid)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Richtung</div><div class="detail-metric-value">${grid === null ? "—" : grid < 0 ? "Einspeisung" : "Bezug"}</div></div>
          </div>
        </div>
      </div>
      <div class="settings-card" style="margin-top:14px;">
        <h3>Netz-Einstellung</h3>
        ${this._entitySelect("grid_power", "Netzleistungsentität", ["sensor"], "Positiv = Bezug, negativ = Einspeisung.")}
      </div>
    `;
  }

  _renderBattery() {
    const soc = this._number(this._entity("battery_soc"));
    const batteryFlow = this._batteryFlow();
    const power = batteryFlow.power;

    return `
      <div class="detail-page">
        <div class="detail-hero" ${this._detailStyle("battery")}>
          <div>
            <div class="detail-icon">${this._icon("battery",76)}</div>
            <div class="detail-title">Batterie</div>
            <div class="detail-subtitle">Ladezustand und aktuelle Lade-/Entladeleistung</div>
            <div class="detail-value">${this._formatPercent(soc)}</div>
            <div class="detail-meta battery-state-${batteryFlow.color}">${this._formatPower(power)} · ${batteryFlow.label}</div>
          </div>
          <div class="detail-grid">
            <div class="detail-metric"><div class="detail-metric-label">SOC</div><div class="detail-metric-value">${this._formatPercent(soc)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Leistung</div><div class="detail-metric-value">${this._formatPower(power)}</div></div>
          </div>
        </div>
      </div>
      <div class="settings-grid" style="margin-top:14px;">
        <div class="settings-card">
          <h3>Ladezustand</h3>
          <p>Aktueller Batteriezustand</p>
          <div class="card-value">${this._formatPercent(soc)}</div>
        </div>

        <div class="settings-card">
          <h3>🔋 Batterieleistung</h3>
          <p>Aktuelle Lade-/Entladeleistung</p>
          <div class="card-value">${this._formatPower(power)}</div>
        </div>

        <div class="settings-card full">
          ${this._entitySelect("battery_soc", "Batterie SOC", ["sensor"], "Ladezustand in Prozent.")}
          ${this._entitySelect("battery_charge_power", "Batterie Ladeleistung", ["sensor"], "Aktuelle Ladeleistung – grün bei Laden.")}
          ${this._entitySelect("battery_discharge_power", "Batterie Entladeleistung", ["sensor"], "Aktuelle Entladeleistung – rot bei Entladen.")}
          ${!this._entity("battery_charge_power") && !this._entity("battery_discharge_power") ? this._entitySelect("battery_power", "Batterieleistung (signiert)", ["sensor"], "Optionaler Fallback: positiv = Laden, negativ = Entladen.") : ""}
        </div>
      </div>
    `;
  }

  _renderWallbox() {
    const power = this._number(this._entity("wallbox_power"));
    const status = this._state(this._entity("wallbox_status"));
    return `
      <div class="detail-page">
        <div class="detail-hero" ${this._detailStyle("wallbox")}>
          <div>
            <div class="detail-icon">${this._icon("car",76)}</div>
            <div class="detail-title">Wallbox</div>
            <div class="detail-subtitle">Aktuelle Ladeleistung und Wallbox-Status</div>
            <div class="detail-value">${this._formatPower(power)}</div>
            <div class="detail-meta">${status ? this._escape(status.state) : "Kein Statussensor hinterlegt"}</div>
          </div>
          <div class="detail-grid">
            <div class="detail-metric"><div class="detail-metric-label">Ladeleistung</div><div class="detail-metric-value">${this._formatPower(power)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Status</div><div class="detail-metric-value">${status ? this._escape(status.state) : "—"}</div></div>
          </div>
        </div>
      </div>
    `;
  }

  _renderHeatpump() {
    const power = this._number(this._entity("heatpump_power"));
    const flow = this._number(this._entity("heatpump_flow_temp"));
    const ret = this._number(this._entity("heatpump_return_temp"));
    const outdoor = this._number(this._entity("heatpump_outdoor_temp"));
    const dhw = this._number(this._entity("heatpump_dhw_temp"));
    const climate = this._state(this._entity("heatpump_entity"));
    return `
      <div class="detail-page">
        <div class="detail-hero" ${this._detailStyle("heatpump")}>
          <div>
            <div class="detail-icon">${this._icon("heat",76)}</div>
            <div class="detail-title">Wärmepumpe</div>
            <div class="detail-subtitle">Leistung, Temperaturen und Betriebszustand</div>
            <div class="detail-value">${this._formatPower(power)}</div>
            <div class="detail-meta">${climate ? this._escape(climate.state) : "Kein Betriebsstatus hinterlegt"}</div>
          </div>
          <div class="detail-grid">
            <div class="detail-metric"><div class="detail-metric-label">Vorlauf</div><div class="detail-metric-value">${this._formatTemp(flow)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Rücklauf</div><div class="detail-metric-value">${this._formatTemp(ret)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Außen</div><div class="detail-metric-value">${this._formatTemp(outdoor)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Warmwasser</div><div class="detail-metric-value">${this._formatTemp(dhw)}</div></div>
          </div>
        </div>
      </div>
    `;
  }

  _renderVehicle() {
    const power = this._number(this._entity("vehicle_charging_power"));
    const soc = this._number(this._entity("vehicle_soc"));
    const status = this._state(this._entity("vehicle_status"));
    return `
      <div class="detail-page">
        <div class="detail-hero" ${this._detailStyle("wallbox")}>
          <div>
            <div class="detail-icon">${this._icon("car",76)}</div>
            <div class="detail-title">${this._escape(this._config.vehicle_name || "Fahrzeug")}</div>
            <div class="detail-subtitle">Fahrzeug- und Ladedaten</div>
            <div class="detail-value">${this._formatPower(power)}</div>
            <div class="detail-meta">${status ? this._escape(status.state) : "Kein Statussensor hinterlegt"}</div>
          </div>
          <div class="detail-grid">
            <div class="detail-metric"><div class="detail-metric-label">Ladeleistung</div><div class="detail-metric-value">${this._formatPower(power)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Fahrzeug SOC</div><div class="detail-metric-value">${this._formatPercent(soc)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Status</div><div class="detail-metric-value">${status ? this._escape(status.state) : "—"}</div></div>
          </div>
        </div>
      </div>
    `;
  }

  _renderClimate() {
    const climate = this._state(this._entity("climate_1"));
    const temp = climate?.attributes?.current_temperature;
    const target = climate?.attributes?.temperature;
    const mode = climate?.state || "—";
    return `
      <div class="detail-page">
        <div class="detail-hero" ${this._detailStyle("climate")}>
          <div>
            <div class="detail-icon">${this._icon("climate",76)}</div>
            <div class="detail-title">Klimaanlagen</div>
            <div class="detail-subtitle">Raumtemperatur, Sollwert und Betriebszustand</div>
            <div class="detail-value">${temp != null ? this._formatTemp(Number(temp)) : "—"}</div>
            <div class="detail-meta">${this._escape(mode)}</div>
          </div>
          <div class="detail-grid">
            <div class="detail-metric"><div class="detail-metric-label">Raumtemperatur</div><div class="detail-metric-value">${temp != null ? this._formatTemp(Number(temp)) : "—"}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Solltemperatur</div><div class="detail-metric-value">${target != null ? this._formatTemp(Number(target)) : "—"}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Betriebsart</div><div class="detail-metric-value">${this._escape(mode)}</div></div>
            <div class="detail-metric"><div class="detail-metric-label">Entität</div><div class="detail-metric-value">${this._escape(this._entity("climate_1") || "—")}</div></div>
          </div>
        </div>
      </div>
      <div class="settings-card" style="margin-top:14px;">
        <h3>Klima-Einstellungen</h3>
        ${this._entitySelect("climate_1", "Klimaanlage 1", ["climate"], "Erste Climate-Entität.")}
        ${this._entitySelect("climate_2", "Klimaanlage 2", ["climate"], "Optional.")}
        ${this._entitySelect("climate_3", "Klimaanlage 3", ["climate"], "Optional.")}
        ${this._entitySelect("climate_4", "Klimaanlage 4", ["climate"], "Optional.")}
      </div>
    `;
  }

  _renderSettings() {
    return `
      <div class="settings-grid">
        <div class="settings-card">
          <h3>⚙ Module</h3>
          <p>Aktivierte Module werden im Dashboard angezeigt.</p>

          ${this._checkbox("energy", "Energie / Haus", "Grundlage des Energie-Dashboards")}
          ${this._checkbox("pv", "Photovoltaik", "PV-Leistung und PV-Daten")}
          ${this._checkbox("grid", "Netz", "Netzbezug und Einspeisung")}
          ${this._checkbox("battery", "Batterie", "Speicher, SOC und Leistung")}
          ${this._checkbox("wallbox", "Wallbox", "Ladeleistung und Wallbox-Status")}
          ${this._checkbox("vehicle", "Fahrzeug", "Fahrzeugdaten und Ladezustand")}
          ${this._checkbox("heatpump", "Wärmepumpe", "Wärmepumpen-Daten")}
          ${this._checkbox("climate", "Klimaanlagen", "Eine oder mehrere Climate-Entitäten")}
        </div>

        <div class="settings-card">
          <h3>🏠 Energie / Haus</h3>
          <p>Grundlegende Leistungsdaten.</p>
          ${this._entitySelect("house_power", "Hausverbrauch", ["sensor"], "Aktueller Hausverbrauch in Watt.")}
          ${this._entitySelect("pv_power", "PV-Leistung", ["sensor"], "Aktuelle PV-Leistung.")}
          ${this._entitySelect("grid_power", "Netzbezug / Einspeisung", ["sensor"], "Positiv = Bezug, negativ = Einspeisung.")}
          ${this._entitySelect("battery_soc", "Batterie SOC", ["sensor"], "Ladezustand in Prozent.")}
          ${this._entitySelect("battery_charge_power", "Batterie Ladeleistung", ["sensor"], "Aktuelle Ladeleistung.")}
          ${this._entitySelect("battery_discharge_power", "Batterie Entladeleistung", ["sensor"], "Aktuelle Entladeleistung.")}
          ${!this._entity("battery_charge_power") && !this._entity("battery_discharge_power") ? this._entitySelect("battery_power", "Batterieleistung (signiert)", ["sensor"], "Optionaler Fallback: positiv = Laden, negativ = Entladen.") : ""}
        </div>

        ${this._enabled("wallbox") || this._enabled("vehicle") ? `
          <div class="settings-card">
            <h3>🚙 Wallbox / Fahrzeug</h3>
            <p>Lade- und Fahrzeugdaten.</p>

            ${this._enabled("wallbox") ? `
              ${this._entitySelect("wallbox_power", "Wallbox Ladeleistung", ["sensor"], "Aktuelle Ladeleistung.")}
              ${this._entitySelect("wallbox_status", "Wallbox Status", ["sensor","binary_sensor"], "Optional.")}
              ${this._entitySelect("wallbox_control", "Wallbox Steuerung", ["switch","button"], "Optional.")}
            ` : ""}

            ${this._enabled("vehicle") ? `
              ${this._textInput("vehicle_name", "Fahrzeugname", this._config.vehicle_name || "")}
              ${this._entitySelect("vehicle_soc", "Fahrzeug SOC", ["sensor"], "Fahrzeug-Ladezustand.")}
              ${this._entitySelect("vehicle_status", "Fahrzeug Status", ["sensor","binary_sensor"], "Optional.")}
              ${this._entitySelect("vehicle_charging_power", "Fahrzeug Ladeleistung", ["sensor"], "Optional.")}
            ` : ""}
          </div>
        ` : ""}

        ${this._enabled("heatpump") || this._enabled("climate") ? `
          <div class="settings-card">
            <h3>♨️ Wärmepumpe / Klima</h3>
            <p>Klima- und Wärmepumpen-Entitäten.</p>

            ${this._enabled("heatpump") ? `
              ${this._entitySelect("heatpump_entity", "Wärmepumpe", ["climate"], "Climate-Entität der Wärmepumpe.")}
              ${this._entitySelect("heatpump_power", "Elektrische Leistung", ["sensor"], "Optional.")}
              ${this._entitySelect("heatpump_flow_temp", "Vorlauftemperatur", ["sensor"], "Optional.")}
              ${this._entitySelect("heatpump_return_temp", "Rücklauftemperatur", ["sensor"], "Optional.")}
              ${this._entitySelect("heatpump_outdoor_temp", "Außentemperatur", ["sensor"], "Optional.")}
              ${this._entitySelect("heatpump_dhw_temp", "Warmwassertemperatur", ["sensor"], "Optional.")}
            ` : ""}

            ${this._enabled("climate") ? `
              ${this._entitySelect("climate_1", "Klimaanlage 1", ["climate"])}
              ${this._entitySelect("climate_2", "Klimaanlage 2", ["climate"])}
              ${this._entitySelect("climate_3", "Klimaanlage 3", ["climate"])}
              ${this._entitySelect("climate_4", "Klimaanlage 4", ["climate"])}
            ` : ""}
          </div>
        ` : ""}

        <div class="settings-card full">
          <h3>🌤 Wetter</h3>
          <p>Optionale Wetterquelle.</p>
          ${this._entitySelect("weather_entity", "Wetter", ["weather"], "Wetterquelle aus Home Assistant.")}
        </div>

        <div class="settings-card full">
          <h3>🖼️ Dashboard-Hintergründe</h3>
          <p>Die Kacheln und Detailseiten verwenden automatisch ein professionelles Standardbild. Ein eigenes Bild ersetzt das Standardbild sofort; „Standardbild“ stellt es wieder her.</p>
          <div class="background-grid">
            ${this._backgroundItem("overview", "Übersicht")}
            ${this._backgroundItem("pv", "PV")}
            ${this._backgroundItem("grid", "Netz")}
            ${this._backgroundItem("battery", "Batterie")}
            ${this._backgroundItem("wallbox", "Wallbox")}
            ${this._backgroundItem("heatpump", "Wärmepumpe")}
            ${this._backgroundItem("climate", "Klimaanlagen")}
            ${this._backgroundItem("settings", "Einstellungen")}
          </div>
        </div>

        <div class="settings-card full">
          ${this._message ? `<div class="message">${this._escape(this._message)}</div>` : ""}
          <div style="display:flex;justify-content:flex-end;">
            <button class="save-button" id="save-config">💾 Änderungen speichern</button>
          </div>
        </div>
      </div>
    `;
  }

  _textInput(key, label, value) {
    return `
      <div class="entity-setting">
        <label>${this._escape(label)}</label>
        <input
          type="text"
          data-text-key="${this._escape(key)}"
          value="${this._escape(value)}"
        />
      </div>
    `;
  }

  _backgroundItem(screen, label) {
    const custom = this._config.backgrounds?.[screen] || "";
    const url = custom || this._defaultBackground(screen);
    const status = custom ? "Eigenes Bild" : (url ? "Standardbild" : "Kein Standardbild");

    return `
      <div class="background-item">
        <strong>${this._escape(label)}</strong>
        <div class="setting-description">${status}</div>

        <div
          class="background-preview"
          style="${url ? `background-image:url('${this._escape(url)}')` : ""}"
        ></div>

        <div class="upload-row">
          <label class="button">
            Bild auswählen
            <input
              class="upload-input"
              data-background-input="${this._escape(screen)}"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            >
          </label>

          <button
            class="button"
            data-reset-background="${this._escape(screen)}"
            type="button"
          >Standardbild</button>
        </div>
      </div>
    `;
  }

  _findInShadowRoots(selector) {
    const found = [];
    const visit = (root) => {
      if (!root) return;
      const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of elements) {
        if (el.matches?.(selector)) found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(document);
    return found;
  }

  _hideHASidebar() {
    // The native collapsed sidebar still reserves a black strip. Hide both the
    // sidebar and its toggle, then expand this panel into the released space.
    if (!window.matchMedia('(min-width: 870px)').matches) return;

    for (const sidebar of new Set(this._findInShadowRoots('ha-sidebar'))) {
      sidebar.style.display = 'none';
      sidebar.style.visibility = 'hidden';
      sidebar.style.width = '0';
      sidebar.style.minWidth = '0';
      sidebar.style.maxWidth = '0';
      sidebar.style.flex = '0 0 0';
    }

    for (const toggle of this._findInShadowRoots('button, ha-icon-button, ha-button-menu')) {
      const label = [
        toggle.getAttribute('aria-label'),
        toggle.getAttribute('title'),
        toggle.ariaLabel,
      ].filter(Boolean).join(' ').toLowerCase();
      if (label.includes('seitenleiste') || label.includes('sidebar')) {
        toggle.style.display = 'none';
        toggle.style.visibility = 'hidden';
      }
    }

    // Read after Home Assistant has applied the hidden sidebar. Some frontend
    // versions reclaim the column themselves; others keep the black strip.
    const hostLeft = Math.round(this.getBoundingClientRect().left);
    const offset = Math.max(0, hostLeft);
    this.style.setProperty('--lakis-sidebar-offset', `${offset}px`);
    this.classList.add('fullscreen-sidebar');
  }

  _attachEvents() {
    this.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (this._tab === "settings") {
          if (this._dirty) await this._save(true);
          if (this._moduleSavePromise) await this._moduleSavePromise;
        }
        this._tab = button.dataset.tab;
        this._message = "";
        this._render();
      });
    });

    this.querySelectorAll("[data-tile-tab]").forEach((tile) => {
      tile.addEventListener("click", async () => {
        if (this._tab === "settings") {
          if (this._dirty) await this._save(true);
          if (this._moduleSavePromise) await this._moduleSavePromise;
        }
        this._tab = tile.dataset.tileTab;
        this._message = "";
        this._render();
      });
    });

    // Module switches use pointerup delegation. Pointer events were verified
    // on the custom element; the production handler now persists the change.
    if (!this._moduleEventsAttached) {
      this.addEventListener("pointerup", this._handleModulePointerUp);
      this._moduleEventsAttached = true;
    }

    this.querySelectorAll("[data-entity-key]").forEach((select) => {
      select.addEventListener("change", (event) => {
        this._config[event.currentTarget.dataset.entityKey] =
          event.currentTarget.value;
        this._dirty = true;
        this._scheduleSave();
      });
    });

    this.querySelectorAll("[data-text-key]").forEach((input) => {
      input.addEventListener("input", (event) => {
        this._config[event.currentTarget.dataset.textKey] =
          event.currentTarget.value;
        this._dirty = true;
        this._scheduleSave();
      });
    });

    const save = this.querySelector("#save-config");
    if (save) {
      save.addEventListener("click", async () => {
        if (this._moduleSavePromise) await this._moduleSavePromise;
        await this._save(false);
      });
    }

    this.querySelectorAll("[data-background-input]").forEach((input) => {
      input.addEventListener("change", (event) => {
        this._uploadBackground(
          event.currentTarget.dataset.backgroundInput,
          event.target.files?.[0]
        );
      });
    });

    this.querySelectorAll("[data-reset-background]").forEach((button) => {
      button.addEventListener("click", () => {
        this._resetBackground(button.dataset.resetBackground);
      });
    });
  }

  _handleModulePointerUp = async (event) => {
    const target = event.target;
    const button = target?.closest?.("[data-module]");

    if (!button || !this.contains(button)) return;

    const module = button.dataset.module;
    if (!module) return;

    event.preventDefault();
    event.stopPropagation();

    const previous = this._enabled(module);
    const enabled = !previous;

    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute(
      "title",
      enabled ? "Modul deaktivieren" : "Modul aktivieren"
    );
    button.querySelector(".switch-box")?.classList.toggle("is-on", enabled);

    await this._setModule(module, enabled, button, previous);
  };

  async _setModule(module, enabled, button, previous) {
    if (!this._hass || !this._entry || !module) return;

    if (Array.isArray(this._config.modules)) {
      const modules = Object.fromEntries(
        this._config.modules
          .filter((name) => typeof name === "string" && name)
          .map((name) => [name, true])
      );
      this._config.modules = modules;
    } else if (!this._config.modules || typeof this._config.modules !== "object") {
      this._config.modules = {};
    }
    this._config.modules[module] = enabled;

    const request = async () => {
      try {
        const result = await this._hass.callWS({
          type: "lakis_solarworld_development/set_module",
          entry_id: this._entry,
          module,
          enabled,
        });

        if (result?.config) {
          this._config = { ...this._config, ...result.config };
        }
        this._config.modules ||= {};
        this._config.modules[module] = enabled;
        this._message = "";
        this._render();
      } catch (err) {
        this._config.modules ||= {};
        this._config.modules[module] = previous;

        if (button) {
          button.setAttribute("aria-pressed", String(previous));
          button.setAttribute(
            "title",
            previous ? "Modul deaktivieren" : "Modul aktivieren"
          );
          const switchBox = button.querySelector(".switch-box");
          if (switchBox) switchBox.classList.toggle("is-on", previous);
        }

        console.error("LAKIS SOLARWORLD module save:", err);
        this._message =
          "Modul konnte nicht gespeichert werden: " +
          (err?.message || "Unbekannter Fehler");
        this._render();
      }
    };

    this._moduleSavePromise =
      (this._moduleSavePromise || Promise.resolve()).then(request);
    await this._moduleSavePromise;
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save(true);
    }, 350);
  }

  async _save(silent = false) {
    if (!this._hass || !this._entry) return;

    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }

    if (this._savePromise) {
      await this._savePromise;
      if (!this._dirty) return;
    }

    const payload = JSON.parse(JSON.stringify(this._config));

    this._savePromise = (async () => {
      try {
        if (!silent) {
          this._message = "Speichere …";
          this._render();
        }

        const result = await this._hass.callWS({
          type: "lakis_solarworld_development/save_config",
          entry_id: this._entry,
          config: payload,
        });

        const returned = result?.config || null;
        if (returned && !this._dirty) this._config = returned;

        const stillSame = JSON.stringify(this._config) === JSON.stringify(payload);
        if (stillSame) this._dirty = false;

        if (!silent) {
          this._message = "✓ Änderungen gespeichert.";
          this._render();
        }
      } catch (err) {
        console.error("LAKIS SOLARWORLD save:", err);
        this._message =
          "Fehler beim Speichern: " +
          (err?.message || "Unbekannter Fehler");
        this._render();
      } finally {
        this._savePromise = null;
      }
    })();

    await this._savePromise;

    if (this._dirty && !this._savePromise) {
      await this._save(true);
    }
  }

  async _uploadBackground(screen, file) {
    if (!file || !this._hass || !this._entry) return;

    const reader = new FileReader();

    reader.onload = async () => {
      try {
        this._message = `Hintergrund für ${screen} wird gespeichert …`;
        this._render();

        const result = await this._hass.callWS({
          type: "lakis_solarworld_development/upload_background_image",
          entry_id: this._entry,
          screen,
          data: reader.result,
        });

        this._config.backgrounds ||= {};
        this._config.backgrounds[screen] = result?.url || "";

        this._message = `✓ Hintergrund für ${screen} gespeichert.`;
        this._render();
      } catch (err) {
        console.error("LAKIS background:", err);
        this._message = "Hintergrundbild konnte nicht gespeichert werden.";
        this._render();
      }
    };

    reader.readAsDataURL(file);
  }

  async _resetBackground(screen) {
    if (!this._hass || !this._entry) return;

    try {
      const result = await this._hass.callWS({
        type: "lakis_solarworld_development/reset_background",
        entry_id: this._entry,
        screen,
      });

      this._config = result?.config || this._config;
      this._message = `✓ Hintergrund für ${screen} zurückgesetzt.`;
      this._render();
    } catch (err) {
      console.error("LAKIS reset background:", err);
      this._message = "Hintergrund konnte nicht zurückgesetzt werden.";
      this._render();
    }
  }

  _renderFooter() {
    return `
      <div class="footer">
        LAKIS SOLARWORLD ENTWICKLUNG — Nachhaltige Energie. Für heute. Für morgen.
        · Version 1.5.9-beta.4 · ENTWICKLUNG
      </div>
    `;
  }
}

if (!customElements.get("lakis-solarworld-development-panel")) {
  customElements.define(
    "lakis-solarworld-development-panel",
    LakisSolarworldDashboard
  );
}
