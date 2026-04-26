// ═══════════════════════════════════════════════════════════════
//  NEXT RACE IDEAS — Suggest 3-5 upcoming iRacing races
//  scored by driver's historical performance.
//
//  Scoring is delegated to web-api: POST /api/v1/calc/next-race-ideas
//  via window.k10CalcClient (modules/js/calc-client.js).
//  This file is the overlay's data-collection + rendering layer only.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── STATE ─────────────────────────────────────────────────────
  let _suggestions = [];
  let _raceHistory = [];
  let _scheduleData = null;

  // ─── UI HELPERS ────────────────────────────────────────────────

  function _getScoreColor(score) {
    if (score >= 80) return 'hsl(140,60%,45%)'; // Green
    if (score >= 60) return 'hsl(80,60%,45%)';  // Lime
    if (score >= 40) return 'hsl(45,70%,50%)';  // Amber
    return 'hsl(15,70%,50%)';                    // Red
  }

  function _getMinutesUntil(targetTime) {
    if (!targetTime) return null;
    const now = new Date();
    const diffMs = new Date(targetTime).getTime() - now.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60)));
  }

  function _truncateSeriesName(name, maxLen = 35) {
    if (!name) return '';
    if (name.length <= maxLen) return name;
    return name.substring(0, maxLen - 3) + '...';
  }

  function _nriEscapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  // ─── DATA FETCH: Season schedule (local SimHub plugin) ─────────
  async function _fetchSchedule() {
    try {
      const resp = await fetch('http://localhost:8889/racecor-io-pro-drive/?action=weekPlanner');
      if (!resp.ok) return null;
      const json = await resp.json();
      if (json.ok && json.data) {
        _scheduleData = json.data;
        return json.data;
      }
    } catch (e) {
      console.warn('next-race-ideas: schedule fetch failed', e);
    }
    return null;
  }

  // ─── DATA FETCH: Race history (web app's /api/sessions) ────────
  async function _fetchRaceHistory() {
    try {
      const token = window._k10Token;
      if (!token) return null;

      const resp = await fetch('https://prodrive.racecor.io/api/sessions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) { _raceHistory = []; return null; }
      const json = await resp.json();
      if (Array.isArray(json)) {
        _raceHistory = json;
        return json;
      }
      _raceHistory = [];
    } catch (e) {
      console.warn('next-race-ideas: history fetch failed', e);
    }
    return null;
  }

  function _getRatingData() {
    if (!window.k10 || !window.k10.getRatingData) return null;
    return window.k10.getRatingData();
  }

  // Derive `driverRatings[]` (current per-category state) from
  // ratings.history by taking the most-recent entry per category.
  function _deriveDriverRatings(ratingsObj) {
    if (!ratingsObj || !Array.isArray(ratingsObj.history)) return [];
    const byCat = {};
    for (const e of ratingsObj.history) {
      if (!e || !e.category) continue;
      const ts = e.createdAt ? new Date(e.createdAt).getTime() : 0;
      const prev = byCat[e.category];
      if (!prev || ts > prev._ts) {
        byCat[e.category] = {
          category: e.category,
          iRating: e.iRating != null ? Number(e.iRating) : 0,
          safetyRating: e.safetyRating != null ? String(e.safetyRating) : '0.00',
          license: e.license || 'R',
          _ts: ts
        };
      }
    }
    return Object.values(byCat).map(r => {
      const { _ts, ...rest } = r;
      return rest;
    });
  }

  // ─── BUILD SUGGESTIONS via web-api ─────────────────────────────
  async function _buildSuggestions() {
    _suggestions = [];

    if (!window.k10CalcClient) {
      console.warn('next-race-ideas: k10CalcClient not loaded');
      return;
    }

    const [schedule, history] = await Promise.all([_fetchSchedule(), _fetchRaceHistory()]);
    const ratings = _getRatingData();
    if (!schedule || !history) return;

    let result;
    try {
      result = await window.k10CalcClient.fetchNextRaceIdeas({
        sessions: history,
        ratings: (ratings && Array.isArray(ratings.history)) ? ratings.history : [],
        driverRatings: _deriveDriverRatings(ratings),
        schedule: schedule,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      });
    } catch (e) {
      console.warn('next-race-ideas: calc API failed', e);
      return;
    }

    const incoming = (result && Array.isArray(result.suggestions)) ? result.suggestions : [];

    _suggestions = incoming.slice(0, 5).map(s => {
      const score = Math.round(Number(s.score) || 0);
      return {
        seriesName: _truncateSeriesName(s.seriesName || ''),
        trackName: s.trackName || 'Unknown',
        score: score,
        scoreColor: _getScoreColor(score),
        minutesUntil: _getMinutesUntil(s.nextStartTime) || 0,
        strategy: s.strategy || { type: 'steady', text: '' },
        commentary: s.commentary || ''
      };
    });
  }

  // ─── RENDER ────────────────────────────────────────────────────
  function _render() {
    const container = document.getElementById('nriCards');
    if (!container) return;

    container.innerHTML = '';

    _suggestions.forEach(suggestion => {
      const card = document.createElement('div');
      card.className = 'nri-card';
      card.style.borderLeftColor = suggestion.scoreColor;

      const headerHtml = `
        <div class="nri-header">
          <div class="nri-series">${_nriEscapeHtml(suggestion.seriesName)}</div>
          <div class="nri-score" style="background:${suggestion.scoreColor};">${suggestion.score}</div>
        </div>
      `;

      const trackHtml = `
        <div class="nri-track">${_nriEscapeHtml(suggestion.trackName)}</div>
      `;

      const timeHtml = `
        <div class="nri-time">Starts in ${suggestion.minutesUntil}m</div>
      `;

      const strategyText = suggestion.strategy && (suggestion.strategy.text || suggestion.strategy.type) || '';
      const strategyType = (suggestion.strategy && suggestion.strategy.type) || 'steady';
      const strategyHtml = `
        <div class="nri-strategy nri-strategy-${_nriEscapeHtml(strategyType)}">${_nriEscapeHtml(strategyText)}</div>
      `;

      const commentaryHtml = `
        <div class="nri-commentary">${_nriEscapeHtml(suggestion.commentary)}</div>
      `;

      card.innerHTML = headerHtml + trackHtml + timeHtml + strategyHtml + commentaryHtml;
      container.appendChild(card);
    });
  }

  // ─── PUBLIC API ────────────────────────────────────────────────

  window.refreshNextRaceIdeas = async function() {
    try {
      await _buildSuggestions();
      _render();
      if (_suggestions.length > 0) {
        showNextRaceIdeas();
      } else {
        hideNextRaceIdeas();
      }
    } catch (e) {
      console.error('next-race-ideas: refresh failed', e);
    }
  };

  window.hideNextRaceIdeas = function() {
    const panel = document.getElementById('nextRaceIdeas');
    if (panel) panel.classList.remove('nri-visible');
  };

  window.showNextRaceIdeas = function() {
    const panel = document.getElementById('nextRaceIdeas');
    if (panel) panel.classList.add('nri-visible');
  };
})();
