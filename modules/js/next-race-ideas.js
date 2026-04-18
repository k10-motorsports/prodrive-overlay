// ═══════════════════════════════════════════════════════════════
//  NEXT RACE IDEAS — Suggest 3-5 upcoming iRacing races
//  scored by driver's historical performance (track/car/conditions)
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════

  let _suggestions = [];
  let _ratingData = null;
  let _raceHistory = [];
  let _scheduleData = null;

  // ═══════════════════════════════════════════════════════════════
  // HELPER: License mapping
  // ═══════════════════════════════════════════════════════════════

  function _licenseToRange(licLetter) {
    const ranges = {
      'R': { min: 1, max: 4 },
      'D': { min: 5, max: 8 },
      'C': { min: 9, max: 12 },
      'B': { min: 13, max: 16 },
      'A': { min: 17, max: 20 },
      'P': { min: 17, max: 20 }
    };
    return ranges[licLetter] || { min: 0, max: 0 };
  }

  function _categoryToTrackType(category) {
    // iRacing categories: road, oval, dirt_road, dirt_oval
    const map = {
      'road': 'road',
      'oval': 'oval',
      'dirt_road': 'dirt_road',
      'dirt_oval': 'dirt_oval'
    };
    return map[category] || category;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Fuzzy string matching (normalized substring)
  // ═══════════════════════════════════════════════════════════════

  function _fuzzyMatch(str1, str2) {
    if (!str1 || !str2) return false;
    const n1 = (str1 + '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const n2 = (str2 + '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return n1.includes(n2) || n2.includes(n1);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Get current week from season start date
  // ═══════════════════════════════════════════════════════════════

  function _getCurrentWeek(seasonStartDate) {
    if (!seasonStartDate) return 0;
    try {
      const start = new Date(seasonStartDate);
      const now = new Date();
      const diffMs = now - start;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return Math.floor(diffDays / 7);
    } catch (e) {
      return 0;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Next session time from race_time_descriptor
  // ═══════════════════════════════════════════════════════════════

  function _getNextSessionTime(descriptor) {
    if (!descriptor) return null;
    const now = new Date();
    const nowMs = now.getTime();

    if (descriptor.repeating) {
      // Repeating session: check if today is a scheduled day
      const todayWeekday = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      // iRacing uses 0=Mon in day_offset, but JS getDay uses 0=Sun
      // Convert JS day (0=Sun) to iRacing day (0=Mon)
      const iRacingDay = (todayWeekday + 6) % 7; // Sun becomes 6, Mon becomes 0, etc.

      const dayOffsets = descriptor.day_offset || [];
      const isToday = dayOffsets.some(d => d === iRacingDay);

      if (!isToday) return null;

      // Parse first_session_time (HH:MM:SS) — iRacing times are UTC
      const parts = (descriptor.first_session_time || '00:00:00').split(':');
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;

      const sessionTime = new Date(now);
      sessionTime.setUTCHours(hours, minutes, seconds, 0);

      const repeatMinutes = descriptor.repeat_minutes || 60;
      let nextSession = new Date(sessionTime);

      // Find next session time that's 5-120 minutes in the future
      while (nextSession.getTime() - nowMs < 5 * 60 * 1000) {
        nextSession = new Date(nextSession.getTime() + repeatMinutes * 60 * 1000);
      }

      if (nextSession.getTime() - nowMs > 120 * 60 * 1000) {
        return null; // Too far in future
      }

      return nextSession;
    } else {
      // Non-repeating: find next session_times entry
      const times = descriptor.session_times || [];
      for (let i = 0; i < times.length; i++) {
        const sessionTime = new Date(times[i]);
        const diffMs = sessionTime.getTime() - nowMs;
        if (diffMs >= 5 * 60 * 1000 && diffMs <= 120 * 60 * 1000) {
          return sessionTime;
        }
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCORING: Track Familiarity (0-25)
  // ═══════════════════════════════════════════════════════════════

  function _scoreTrackFamiliarity(trackName, history) {
    if (!history || history.length === 0) return 0;

    const raceCount = history.filter(r => _fuzzyMatch(r.trackName, trackName)).length;

    if (raceCount >= 5) return 25;
    if (raceCount >= 3) return 20;
    if (raceCount === 2) return 15;
    if (raceCount === 1) return 8;
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCORING: Track Incident Rate (0-25)
  // ═══════════════════════════════════════════════════════════════

  function _scoreTrackIncidentRate(trackName, history) {
    if (!history || history.length === 0) return 10;

    const trackRaces = history.filter(r => _fuzzyMatch(r.trackName, trackName));
    if (trackRaces.length === 0) return 10; // Neutral for new tracks

    // Avg incidents/lap at this track
    let trackIncidentsPerLap = 0;
    let trackLapCount = 0;
    trackRaces.forEach(r => {
      const completed = r.completedLaps || 1;
      trackIncidentsPerLap += (r.incidentCount || 0) / completed;
      trackLapCount += completed;
    });
    trackIncidentsPerLap /= Math.max(1, trackRaces.length);

    // Overall avg incidents/lap
    let totalIncidentsPerLap = 0;
    let totalLapCount = 0;
    history.forEach(r => {
      const completed = r.completedLaps || 1;
      totalIncidentsPerLap += (r.incidentCount || 0) / completed;
      totalLapCount += completed;
    });
    totalIncidentsPerLap /= Math.max(1, history.length);

    if (totalIncidentsPerLap === 0) return 15; // No baseline

    const ratio = trackIncidentsPerLap / totalIncidentsPerLap;

    if (ratio < 0.5) return 25;
    if (ratio < 0.8) return 20;
    if (ratio < 1.0) return 15;
    if (ratio < 1.2) return 10;
    if (ratio < 1.5) return 5;
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCORING: Car Familiarity (0-15)
  // ═══════════════════════════════════════════════════════════════

  function _scoreCarFamiliarity(carClassNames, history) {
    if (!history || history.length === 0 || !carClassNames || carClassNames.length === 0) return 0;

    const carNames = carClassNames.map(c => (c.short_name || c.name || '').toLowerCase());

    const matchingRaces = history.filter(r => {
      const histCar = (r.carModel || '').toLowerCase();
      return carNames.some(cn => _fuzzyMatch(histCar, cn));
    });

    const count = matchingRaces.length;
    if (count >= 5) return 15;
    if (count >= 3) return 12;
    if (count >= 1) return 6;
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // SCORING: Time-of-Day Factor (0-10)
  // ═══════════════════════════════════════════════════════════════

  function _scoreTimeOfDay(raceStartTime, history) {
    if (!history || history.length < 5) return 5; // Insufficient data

    // Group history by hour of day
    const hourStats = {};
    history.forEach(r => {
      if (!r.startedAt) return;
      const hour = new Date(r.startedAt).getHours();
      if (!hourStats[hour]) hourStats[hour] = [];
      hourStats[hour].push(r);
    });

    // Compute avg incidents/lap per hour
    const hourMetrics = {};
    Object.keys(hourStats).forEach(h => {
      const races = hourStats[h];
      let incPerLap = 0;
      races.forEach(r => {
        const completed = r.completedLaps || 1;
        incPerLap += (r.incidentCount || 0) / completed;
      });
      hourMetrics[h] = incPerLap / races.length;
    });

    // Rank hours by performance (lower incidents = better)
    const sortedHours = Object.keys(hourMetrics).sort((a, b) => hourMetrics[a] - hourMetrics[b]);

    // Find quartile for race start hour
    const raceHour = raceStartTime.getHours();
    const position = sortedHours.indexOf(String(raceHour));

    if (position < 0) return 5; // Hour not in history
    const quartile = Math.floor((position / sortedHours.length) * 4);

    if (quartile === 0) return 10; // Best 25%
    if (quartile === 1) return 7;  // Next 25%
    if (quartile === 2) return 4;  // Next 25%
    return 0; // Worst 25%
  }

  // ═══════════════════════════════════════════════════════════════
  // SCORING: Day-of-Week Factor (0-10)
  // ═══════════════════════════════════════════════════════════════

  function _scoreDayOfWeek(raceStartTime, history) {
    if (!history || history.length < 5) return 5; // Insufficient data

    // Group history by day of week
    const dayStats = {};
    history.forEach(r => {
      if (!r.startedAt) return;
      const day = new Date(r.startedAt).getDay();
      if (!dayStats[day]) dayStats[day] = [];
      dayStats[day].push(r);
    });

    // Compute avg incidents/lap per day
    const dayMetrics = {};
    Object.keys(dayStats).forEach(d => {
      const races = dayStats[d];
      let incPerLap = 0;
      races.forEach(r => {
        const completed = r.completedLaps || 1;
        incPerLap += (r.incidentCount || 0) / completed;
      });
      dayMetrics[d] = incPerLap / races.length;
    });

    // Rank days by performance
    const sortedDays = Object.keys(dayMetrics).sort((a, b) => dayMetrics[a] - dayMetrics[b]);

    // Find quartile for race day
    const raceDay = raceStartTime.getDay();
    const position = sortedDays.indexOf(String(raceDay));

    if (position < 0) return 5; // Day not in history
    const quartile = Math.floor((position / sortedDays.length) * 4);

    if (quartile === 0) return 10; // Best 25%
    if (quartile === 1) return 7;  // Next 25%
    if (quartile === 2) return 4;  // Next 25%
    return 0; // Worst 25%
  }

  // ═══════════════════════════════════════════════════════════════
  // SCORING: Rating Trend (0-15)
  // ═══════════════════════════════════════════════════════════════

  function _scoreRatingTrend(history) {
    if (!history || history.length < 5) return 4; // Default to flat

    const last5 = history.slice(-5);

    let irScore = 4; // Flat default
    const irDeltas = last5.map(r => r.estimatedIRatingDelta || 0);
    const avgIRDelta = irDeltas.reduce((a, b) => a + b, 0) / irDeltas.length;
    if (avgIRDelta > 0) irScore = 8;   // Trending up
    else if (avgIRDelta < 0) irScore = 0; // Trending down

    let srScore = 3; // Flat default
    // SR deltas computed from rating history (not in session data, so approximate)
    const srDeltas = last5.map((r, i) => {
      if (i === 0) return 0;
      return (r.preRaceSR || 0) - (last5[i - 1].preRaceSR || 0);
    });
    const avgSRDelta = srDeltas.reduce((a, b) => a + b, 0) / (srDeltas.length - 1 || 1);
    if (avgSRDelta > 0) srScore = 7;   // Trending up
    else if (avgSRDelta < 0) srScore = 0; // Trending down

    return Math.min(15, irScore + srScore);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Compute overall score (0-100)
  // ═══════════════════════════════════════════════════════════════

  function _computeScore(race, history) {
    const trackFamiliarity = _scoreTrackFamiliarity(race.track.track_name, history);
    const trackIncidents = _scoreTrackIncidentRate(race.track.track_name, history);
    const carFamiliarity = _scoreCarFamiliarity(race.car_classes || [], history);
    const timeOfDay = _scoreTimeOfDay(race.nextSessionTime, history);
    const dayOfWeek = _scoreDayOfWeek(race.nextSessionTime, history);
    const ratingTrend = _scoreRatingTrend(history);

    return trackFamiliarity + trackIncidents + carFamiliarity + timeOfDay + dayOfWeek + ratingTrend;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Generate strategy suggestion
  // ═══════════════════════════════════════════════════════════════

  function _getStrategy(history) {
    if (!history || history.length < 5) {
      return { type: 'conservative', text: 'Steady approach — focus on finishing well' };
    }

    const last5 = history.slice(-5);
    const avgIRDelta = last5.reduce((sum, r) => sum + (r.estimatedIRatingDelta || 0), 0) / last5.length;
    // Compute SR trend from consecutive preRaceSR values
    let srDeltaSum = 0;
    let srDeltaCount = 0;
    for (let i = 1; i < last5.length; i++) {
      const prev = last5[i - 1].preRaceSR;
      const curr = last5[i].preRaceSR;
      if (typeof prev === 'number' && typeof curr === 'number') {
        srDeltaSum += curr - prev;
        srDeltaCount++;
      }
    }
    const avgSRDelta = srDeltaCount > 0 ? srDeltaSum / srDeltaCount : 0;

    if (avgIRDelta < -30 && avgSRDelta < 0) {
      return { type: 'pitlane', text: 'Start from pit lane — focus on clean, incident-free laps' };
    }
    if (avgIRDelta < -30 && avgSRDelta >= 0) {
      return { type: 'conservative', text: 'Conservative start — avoid lap-1 chaos, build rhythm' };
    }
    if (avgIRDelta >= -30 && avgSRDelta < -0.05) {
      return { type: 'careful', text: 'Careful with contact — pace is there but incidents are costly' };
    }
    if (avgIRDelta >= 0 && avgSRDelta >= 0) {
      return { type: 'form', text: 'You\'re on form — fight for position from the grid' };
    }

    return { type: 'conservative', text: 'Steady approach — focus on finishing well' };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Generate commentary
  // ═══════════════════════════════════════════════════════════════

  function _getCommentary(race, history, minutesUntilStart) {
    const trackRaces = history.filter(r => _fuzzyMatch(r.trackName, race.track.track_name));
    const trackCount = trackRaces.length;

    let trackText = '';
    if (trackCount === 0) {
      trackText = 'New track — bring your A-game. ';
    } else if (trackCount >= 5) {
      trackText = 'You know this track. ';
    } else {
      trackText = trackCount === 1 ? '1 race here. ' : `${trackCount} races here. `;
    }

    // Incident rate comparison
    let incidentText = '';
    if (trackCount > 0) {
      const trackIncPerLap = trackRaces.reduce((sum, r) => sum + (r.incidentCount || 0) / Math.max(1, r.completedLaps || 1), 0) / trackCount;
      const totalIncPerLap = history.reduce((sum, r) => sum + (r.incidentCount || 0) / Math.max(1, r.completedLaps || 1), 0) / history.length;
      const ratio = trackIncPerLap / (totalIncPerLap || 1);

      if (ratio < 0.6) {
        incidentText = 'Your incident rate here is excellent. ';
      } else if (ratio < 1.0) {
        incidentText = 'Your incident rate matches your average. ';
      } else {
        incidentText = 'Watch your incidents here — you struggle with grip. ';
      }
    }

    // Interval
    let intervalText = '';
    if (race.race_time_descriptors && race.race_time_descriptors.length > 0) {
      const descriptor = race.race_time_descriptors[0];
      const repeatMin = descriptor.repeat_minutes || 60;
      intervalText = `Races every ${repeatMin}m. `;
    }

    // License
    let licenseText = '';
    if (race.min_license_level > 0) {
      // min_license_level: 1-4=R, 5-8=D, 9-12=C, 13-16=B, 17-20=A/P
      const licIdx = Math.floor((race.min_license_level - 1) / 4);
      const levels = ['Rookie', 'D', 'C', 'B', 'A'];
      const licLetter = levels[Math.min(licIdx, 4)];
      licenseText = `${licLetter} license.`;
    }

    return trackText + incidentText + intervalText + licenseText;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Score color (hsl string)
  // ═══════════════════════════════════════════════════════════════

  function _getScoreColor(score) {
    if (score >= 80) return 'hsl(140,60%,45%)'; // Green
    if (score >= 60) return 'hsl(80,60%,45%)';  // Lime
    if (score >= 40) return 'hsl(45,70%,50%)';  // Amber
    return 'hsl(20,70%,50%)';                   // Red-orange
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Format time until race
  // ═══════════════════════════════════════════════════════════════

  function _getMinutesUntil(targetTime) {
    if (!targetTime) return null;
    const now = new Date();
    const diffMs = targetTime.getTime() - now.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60)));
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Truncate series name
  // ═══════════════════════════════════════════════════════════════

  function _truncateSeriesName(name, maxLen = 35) {
    if (!name) return '';
    if (name.length <= maxLen) return name;
    return name.substring(0, maxLen - 3) + '...';
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA FETCH: Season schedule
  // ═══════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════
  // DATA FETCH: Race history
  // ═══════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════
  // DATA FETCH: Current ratings
  // ═══════════════════════════════════════════════════════════════

  function _getRatingData() {
    if (!window.k10 || !window.k10.getRatingData) return null;
    return window.k10.getRatingData();
  }

  // ═══════════════════════════════════════════════════════════════
  // BUILD SUGGESTIONS
  // ═══════════════════════════════════════════════════════════════

  async function _buildSuggestions() {
    _suggestions = [];

    // Fetch data
    const schedule = await _fetchSchedule();
    const history = await _fetchRaceHistory();
    const ratings = _getRatingData();

    if (!schedule || !history) return;

    // Infer driver's licenses per category from history
    const driverLicenses = {};
    if (ratings && ratings.history && ratings.history.length > 0) {
      ratings.history.forEach(entry => {
        if (entry.category && entry.license) {
          const catType = _categoryToTrackType(entry.category);
          driverLicenses[catType] = entry.license;
        }
      });
    }

    // Flatten all races from all seasons
    const allRaces = [];
    schedule.forEach(season => {
      if (!season.schedules) return;

      season.schedules.forEach((schedule, weekIdx) => {
        const track = schedule.track || {};
        const descriptors = schedule.race_time_descriptors || [];

        // Try to get next session time
        let nextSessionTime = null;
        for (let i = 0; i < descriptors.length; i++) {
          nextSessionTime = _getNextSessionTime(descriptors[i]);
          if (nextSessionTime) break;
        }

        // Skip if no upcoming session in the next 5-120 minutes
        if (!nextSessionTime) return;

        // License filter: check if driver has license for this category
        const trackType = track.category || 'road';
        const driverLicense = driverLicenses[trackType];
        if (!driverLicense) return; // Skip if no history in this category

        const licRange = _licenseToRange(driverLicense);
        if (season.min_license_level > licRange.max) return; // Driver license insufficient

        const race = {
          season_id: season.season_id,
          series_id: season.series_id,
          series_name: season.series_name,
          official: season.official,
          fixed_setup: season.fixed_setup,
          license_group: season.license_group,
          license_group_name: season.license_group_name,
          min_license_level: season.min_license_level,
          track: track,
          car_classes: season.car_classes || [],
          race_time_descriptors: descriptors,
          nextSessionTime: nextSessionTime,
          week_num: weekIdx
        };

        allRaces.push(race);
      });
    });

    // Score all races
    const scored = allRaces.map(race => {
      const score = _computeScore(race, history);
      return { race, score };
    });

    // Sort by score descending, take top 5
    scored.sort((a, b) => b.score - a.score);
    const topRaces = scored.slice(0, 5).filter(s => s.score > 0);

    // Build suggestion objects
    _suggestions = topRaces.map(({ race, score }) => {
      const minutesUntil = _getMinutesUntil(race.nextSessionTime) || 0;
      const strategy = _getStrategy(history);
      const commentary = _getCommentary(race, history, minutesUntil);
      const color = _getScoreColor(score);
      const seriesTruncated = _truncateSeriesName(race.series_name);

      return {
        seriesName: seriesTruncated,
        trackName: race.track.track_name || 'Unknown',
        score: Math.round(score),
        scoreColor: color,
        minutesUntil: minutesUntil,
        strategy: strategy,
        commentary: commentary
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER SUGGESTIONS
  // ═══════════════════════════════════════════════════════════════

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

      const strategyHtml = `
        <div class="nri-strategy nri-strategy-${suggestion.strategy.type}">${_nriEscapeHtml(suggestion.strategy.text)}</div>
      `;

      const commentaryHtml = `
        <div class="nri-commentary">${_nriEscapeHtml(suggestion.commentary)}</div>
      `;

      card.innerHTML = headerHtml + trackHtml + timeHtml + strategyHtml + commentaryHtml;
      container.appendChild(card);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: HTML escape
  // ═══════════════════════════════════════════════════════════════

  function _nriEscapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

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
    if (panel) {
      panel.classList.remove('nri-visible');
    }
  };

  window.showNextRaceIdeas = function() {
    const panel = document.getElementById('nextRaceIdeas');
    if (panel) {
      panel.classList.add('nri-visible');
    }
  };

})();
