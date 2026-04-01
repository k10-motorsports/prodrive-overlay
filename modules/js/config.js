// K10 Motorsports Dashboard — Shared Configuration & State
// This module defines all global constants and state variables used across other modules.
// All variables are implicitly global (shared scope) since modules load via <script src> tags.

// ═══════════════════════════════════════════════════════════════
// SIMHUB HTTP API CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const SIMHUB_URL = 'http://localhost:8889/k10mediabroadcaster/';
const POLL_MS = 33; // ~30fps

// All properties we need, batched into a single request
const PROP_KEYS = [
  'DataCorePlugin.GameRunning',
  'K10Motorsports.Plugin.GameId',
  'DataCorePlugin.GameData.Gear',
  'DataCorePlugin.GameData.Rpms',
  'DataCorePlugin.GameData.CarSettings_MaxRPM',
  'DataCorePlugin.GameData.SpeedMph',
  'DataCorePlugin.GameData.Throttle',
  'DataCorePlugin.GameData.Brake',
  'DataCorePlugin.GameData.Clutch',
  'DataCorePlugin.GameData.Fuel',
  'DataCorePlugin.GameData.MaxFuel',
  'DataCorePlugin.Computed.Fuel_LitersPerLap',
  'DataCorePlugin.GameData.RemainingLaps',
  'DataCorePlugin.GameData.TyreTempFrontLeft',
  'DataCorePlugin.GameData.TyreTempFrontRight',
  'DataCorePlugin.GameData.TyreTempRearLeft',
  'DataCorePlugin.GameData.TyreTempRearRight',
  'DataCorePlugin.GameData.TyreWearFrontLeft',
  'DataCorePlugin.GameData.TyreWearFrontRight',
  'DataCorePlugin.GameData.TyreWearRearLeft',
  'DataCorePlugin.GameData.TyreWearRearRight',
  'DataCorePlugin.GameRawData.Telemetry.dcBrakeBias',
  'DataCorePlugin.GameRawData.Telemetry.dcTractionControl',
  'DataCorePlugin.GameRawData.Telemetry.dcABS',
  'DataCorePlugin.GameRawData.Telemetry.dcAntiRollFront',
  'DataCorePlugin.GameRawData.Telemetry.dcAntiRollRear',
  'DataCorePlugin.GameData.Position',
  'DataCorePlugin.GameData.CurrentLap',
  'DataCorePlugin.GameData.BestLapTime',
  'DataCorePlugin.GameData.CarModel',
  'IRacingExtraProperties.iRacing_DriverInfo_IRating',
  'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_Gap',
  'IRacingExtraProperties.iRacing_Opponent_Behind_Gap',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_Name',
  'IRacingExtraProperties.iRacing_Opponent_Behind_Name',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_IRating',
  'IRacingExtraProperties.iRacing_Opponent_Behind_IRating',
  'DataCorePlugin.GameRawData.Telemetry.FrameRate',
  'DataCorePlugin.GameRawData.Telemetry.SteeringWheelAngle',
  'DataCorePlugin.GameData.SessionTimeSpan',
  'DataCorePlugin.GameData.CurrentLapTime',
  'DataCorePlugin.GameData.LastLapTime',
  'DataCorePlugin.GameData.RemainingTime',
  'DataCorePlugin.GameData.TotalLaps',
  'K10Motorsports.Plugin.CommentaryVisible',
  'K10Motorsports.Plugin.CommentaryText',
  'K10Motorsports.Plugin.CommentaryTopicTitle',
  'K10Motorsports.Plugin.CommentaryTopicId',
  'K10Motorsports.Plugin.CommentaryCategory',
  'K10Motorsports.Plugin.CommentarySentimentColor',
  'K10Motorsports.Plugin.CommentarySeverity',
  // Strategy engine properties
  'K10Motorsports.Plugin.Strategy.Visible',
  'K10Motorsports.Plugin.Strategy.Text',
  'K10Motorsports.Plugin.Strategy.Label',
  'K10Motorsports.Plugin.Strategy.Severity',
  'K10Motorsports.Plugin.Strategy.Color',
  'K10Motorsports.Plugin.Strategy.TextColor',
  'K10Motorsports.Plugin.Strategy.FuelLapsRemaining',
  'K10Motorsports.Plugin.Strategy.FuelHealthState',
  'K10Motorsports.Plugin.Strategy.CanMakeItToEnd',
  'K10Motorsports.Plugin.Strategy.PitWindowOpen',
  'K10Motorsports.Plugin.Strategy.PitWindowClose',
  'K10Motorsports.Plugin.Strategy.TireHealthState',
  'K10Motorsports.Plugin.Strategy.TireLapsRemaining',
  'K10Motorsports.Plugin.Strategy.GripScore',
  'K10Motorsports.Plugin.Strategy.StintNumber',
  'K10Motorsports.Plugin.Strategy.StintLaps',
  'K10Motorsports.Plugin.SessionTypeName',
  // Demo mode properties
  'K10Motorsports.Plugin.DemoMode',
  'K10Motorsports.Plugin.Demo.Gear',
  'K10Motorsports.Plugin.Demo.Rpm',
  'K10Motorsports.Plugin.Demo.MaxRpm',
  'K10Motorsports.Plugin.Demo.SpeedMph',
  'K10Motorsports.Plugin.Demo.Throttle',
  'K10Motorsports.Plugin.Demo.Brake',
  'K10Motorsports.Plugin.Demo.Clutch',
  'K10Motorsports.Plugin.Demo.Fuel',
  'K10Motorsports.Plugin.Demo.MaxFuel',
  'K10Motorsports.Plugin.Demo.FuelPerLap',
  'K10Motorsports.Plugin.Demo.RemainingLaps',
  'K10Motorsports.Plugin.Demo.TyreTempFL',
  'K10Motorsports.Plugin.Demo.TyreTempFR',
  'K10Motorsports.Plugin.Demo.TyreTempRL',
  'K10Motorsports.Plugin.Demo.TyreTempRR',
  'K10Motorsports.Plugin.Demo.TyreWearFL',
  'K10Motorsports.Plugin.Demo.TyreWearFR',
  'K10Motorsports.Plugin.Demo.TyreWearRL',
  'K10Motorsports.Plugin.Demo.TyreWearRR',
  'K10Motorsports.Plugin.Demo.BrakeBias',
  'K10Motorsports.Plugin.Demo.TC',
  'K10Motorsports.Plugin.Demo.ABS',
  'K10Motorsports.Plugin.Demo.SessionTypeName',
  'K10Motorsports.Plugin.Demo.Position',
  'K10Motorsports.Plugin.Demo.CurrentLap',
  'K10Motorsports.Plugin.Demo.BestLapTime',
  'K10Motorsports.Plugin.Demo.CarModel',
  'K10Motorsports.Plugin.Demo.SessionTime',
  'K10Motorsports.Plugin.Demo.CurrentLapTime',
  'K10Motorsports.Plugin.Demo.LastLapTime',
  'K10Motorsports.Plugin.Demo.RemainingTime',
  'K10Motorsports.Plugin.Demo.TotalLaps',
  'K10Motorsports.Plugin.Demo.IRating',
  'K10Motorsports.Plugin.Demo.SafetyRating',
  'K10Motorsports.Plugin.Demo.GapAhead',
  'K10Motorsports.Plugin.Demo.GapBehind',
  'K10Motorsports.Plugin.Demo.DriverAhead',
  'K10Motorsports.Plugin.Demo.DriverBehind',
  'K10Motorsports.Plugin.Demo.IRAhead',
  'K10Motorsports.Plugin.Demo.IRBehind',
  // Datastream (advanced telemetry)
  'K10Motorsports.Plugin.DS.LatG',
  'K10Motorsports.Plugin.DS.LongG',
  'K10Motorsports.Plugin.DS.YawRate',
  'K10Motorsports.Plugin.DS.SteerTorque',
  'K10Motorsports.Plugin.DS.TrackTemp',
  'K10Motorsports.Plugin.DS.IncidentCount',
  'K10Motorsports.Plugin.DS.EstimatedIRatingDelta',
  'K10Motorsports.Plugin.DS.IRatingFieldSize',
  'K10Motorsports.Plugin.DS.AbsActive',
  'K10Motorsports.Plugin.DS.TcActive',
  'K10Motorsports.Plugin.DS.TrackPct',
  'K10Motorsports.Plugin.DS.LapDelta',
  'K10Motorsports.Plugin.DS.CurrentSector',
  'K10Motorsports.Plugin.DS.SectorCount',
  'K10Motorsports.Plugin.DS.SectorSplits',
  'K10Motorsports.Plugin.DS.SectorDeltas',
  'K10Motorsports.Plugin.DS.SectorStates',
  'K10Motorsports.Plugin.DS.SectorBoundaryPcts',
  'K10Motorsports.Plugin.DS.SectorSplitS1',
  'K10Motorsports.Plugin.DS.SectorSplitS2',
  'K10Motorsports.Plugin.DS.SectorSplitS3',
  'K10Motorsports.Plugin.DS.SectorDeltaS1',
  'K10Motorsports.Plugin.DS.SectorDeltaS2',
  'K10Motorsports.Plugin.DS.SectorDeltaS3',
  'K10Motorsports.Plugin.DS.SectorStateS1',
  'K10Motorsports.Plugin.DS.SectorStateS2',
  'K10Motorsports.Plugin.DS.SectorStateS3',
  'K10Motorsports.Plugin.DS.SectorS2StartPct',
  'K10Motorsports.Plugin.DS.SectorS3StartPct',
  'K10Motorsports.Plugin.DS.CompletedLaps',
  'K10Motorsports.Plugin.DS.IsInPitLane',
  'K10Motorsports.Plugin.DS.SpeedKmh',
  'K10Motorsports.Plugin.DS.PitLimiterOn',
  'K10Motorsports.Plugin.DS.PitSpeedLimitKmh',
  // Computed DS.* (server-side calculations)
  'K10Motorsports.Plugin.DS.ThrottleNorm',
  'K10Motorsports.Plugin.DS.BrakeNorm',
  'K10Motorsports.Plugin.DS.ClutchNorm',
  'K10Motorsports.Plugin.DS.RpmRatio',
  'K10Motorsports.Plugin.DS.FuelPct',
  'K10Motorsports.Plugin.DS.FuelLapsRemaining',
  'K10Motorsports.Plugin.DS.SpeedMph',
  'K10Motorsports.Plugin.DS.PitSpeedLimitMph',
  'K10Motorsports.Plugin.DS.IsPitSpeeding',
  'K10Motorsports.Plugin.DS.IsNonRaceSession',
  'K10Motorsports.Plugin.DS.IsTimedRace',
  'K10Motorsports.Plugin.DS.IsEndOfRace',
  'K10Motorsports.Plugin.DS.PositionDelta',
  'K10Motorsports.Plugin.DS.StartPosition',
  'K10Motorsports.Plugin.DS.RemainingTimeFormatted',
  'K10Motorsports.Plugin.DS.SpeedDisplay',
  'K10Motorsports.Plugin.DS.RpmDisplay',
  'K10Motorsports.Plugin.DS.FuelFormatted',
  'K10Motorsports.Plugin.DS.FuelPerLapFormatted',
  'K10Motorsports.Plugin.DS.PitSuggestion',
  'K10Motorsports.Plugin.DS.BBNorm',
  'K10Motorsports.Plugin.DS.TCNorm',
  'K10Motorsports.Plugin.DS.ABSNorm',
  'K10Motorsports.Plugin.DS.PositionDeltaDisplay',
  'K10Motorsports.Plugin.DS.LapDeltaDisplay',
  'K10Motorsports.Plugin.DS.SafetyRatingDisplay',
  'K10Motorsports.Plugin.DS.GapAheadFormatted',
  'K10Motorsports.Plugin.DS.GapBehindFormatted',
  // Ambient light (screen color from C# plugin)
  'K10Motorsports.Plugin.DS.AmbientR',
  'K10Motorsports.Plugin.DS.AmbientG',
  'K10Motorsports.Plugin.DS.AmbientB',
  'K10Motorsports.Plugin.DS.AmbientHasData',
  // Demo Datastream
  'K10Motorsports.Plugin.Demo.DS.LatG',
  'K10Motorsports.Plugin.Demo.DS.LongG',
  'K10Motorsports.Plugin.Demo.DS.YawRate',
  'K10Motorsports.Plugin.Demo.DS.SteerTorque',
  'K10Motorsports.Plugin.Demo.DS.TrackTemp',
  'K10Motorsports.Plugin.Demo.DS.IncidentCount',
  'K10Motorsports.Plugin.Demo.DS.AbsActive',
  'K10Motorsports.Plugin.Demo.DS.TcActive',
  'K10Motorsports.Plugin.Demo.DS.LapDelta',
  'K10Motorsports.Plugin.Demo.DS.IsInPitLane',
  'K10Motorsports.Plugin.Demo.DS.SpeedKmh',
  'K10Motorsports.Plugin.Demo.DS.PitLimiterOn',
  'K10Motorsports.Plugin.Demo.DS.PitSpeedLimitKmh',
  // Demo Computed DS.*
  'K10Motorsports.Plugin.Demo.DS.ThrottleNorm',
  'K10Motorsports.Plugin.Demo.DS.BrakeNorm',
  'K10Motorsports.Plugin.Demo.DS.ClutchNorm',
  'K10Motorsports.Plugin.Demo.DS.RpmRatio',
  'K10Motorsports.Plugin.Demo.DS.FuelPct',
  'K10Motorsports.Plugin.Demo.DS.FuelLapsRemaining',
  'K10Motorsports.Plugin.Demo.DS.SpeedMph',
  'K10Motorsports.Plugin.Demo.DS.PitSpeedLimitMph',
  'K10Motorsports.Plugin.Demo.DS.IsPitSpeeding',
  'K10Motorsports.Plugin.Demo.DS.IsNonRaceSession',
  'K10Motorsports.Plugin.Demo.DS.IsTimedRace',
  'K10Motorsports.Plugin.Demo.DS.IsEndOfRace',
  'K10Motorsports.Plugin.Demo.DS.PositionDelta',
  'K10Motorsports.Plugin.Demo.DS.StartPosition',
  'K10Motorsports.Plugin.Demo.DS.RemainingTimeFormatted',
  'K10Motorsports.Plugin.Demo.DS.SpeedDisplay',
  'K10Motorsports.Plugin.Demo.DS.RpmDisplay',
  'K10Motorsports.Plugin.Demo.DS.FuelFormatted',
  'K10Motorsports.Plugin.Demo.DS.FuelPerLapFormatted',
  'K10Motorsports.Plugin.Demo.DS.PitSuggestion',
  'K10Motorsports.Plugin.Demo.DS.BBNorm',
  'K10Motorsports.Plugin.Demo.DS.TCNorm',
  'K10Motorsports.Plugin.Demo.DS.ABSNorm',
  'K10Motorsports.Plugin.Demo.DS.PositionDeltaDisplay',
  'K10Motorsports.Plugin.Demo.DS.LapDeltaDisplay',
  'K10Motorsports.Plugin.Demo.DS.SafetyRatingDisplay',
  'K10Motorsports.Plugin.Demo.DS.GapAheadFormatted',
  'K10Motorsports.Plugin.Demo.DS.GapBehindFormatted',
  // Track map
  'K10Motorsports.Plugin.TrackMap.Ready',
  'K10Motorsports.Plugin.TrackMap.TrackName',
  'K10Motorsports.Plugin.TrackMap.SvgPath',
  'K10Motorsports.Plugin.TrackMap.PlayerX',
  'K10Motorsports.Plugin.TrackMap.PlayerY',
  'K10Motorsports.Plugin.TrackMap.PlayerHeading',
  'K10Motorsports.Plugin.TrackMap.Opponents',
  'DataCorePlugin.GameData.TrackName',
  // Leaderboard
  'K10Motorsports.Plugin.Leaderboard',
  // Driver name
  'K10Motorsports.Plugin.DriverFirstName',
  'K10Motorsports.Plugin.DriverLastName',
  // Flag status
  'currentFlagState',
  // Grid / Formation state
  'K10Motorsports.Plugin.Grid.SessionState',
  'K10Motorsports.Plugin.Grid.GriddedCars',
  'K10Motorsports.Plugin.Grid.TotalCars',
  'K10Motorsports.Plugin.Grid.PaceMode',
  'K10Motorsports.Plugin.Grid.StartType',
  'K10Motorsports.Plugin.Grid.LightsPhase',
  'K10Motorsports.Plugin.Demo.Grid.SessionState',
  'K10Motorsports.Plugin.Demo.Grid.GriddedCars',
  'K10Motorsports.Plugin.Demo.Grid.TotalCars',
  'K10Motorsports.Plugin.Demo.Grid.PaceMode',
  'K10Motorsports.Plugin.Demo.Grid.LightsPhase',
  'K10Motorsports.Plugin.Demo.Grid.StartType',
  'K10Motorsports.Plugin.Grid.TrackCountry',
  'K10Motorsports.Plugin.Demo.Grid.TrackCountry',
  // Pit Box (iRacing pit stop selections + car adjustments)
  'K10Motorsports.Plugin.PitBox.PitSvFlags',
  'K10Motorsports.Plugin.PitBox.PitSvFuel',
  'K10Motorsports.Plugin.PitBox.PitSvLFP',
  'K10Motorsports.Plugin.PitBox.PitSvRFP',
  'K10Motorsports.Plugin.PitBox.PitSvLRP',
  'K10Motorsports.Plugin.PitBox.PitSvRRP',
  'K10Motorsports.Plugin.PitBox.TireCompound',
  'K10Motorsports.Plugin.PitBox.FastRepair',
  'K10Motorsports.Plugin.PitBox.Windshield',
  'K10Motorsports.Plugin.PitBox.TireLF',
  'K10Motorsports.Plugin.PitBox.TireRF',
  'K10Motorsports.Plugin.PitBox.TireLR',
  'K10Motorsports.Plugin.PitBox.TireRR',
  'K10Motorsports.Plugin.PitBox.TiresRequested',
  'K10Motorsports.Plugin.PitBox.FuelRequested',
  'K10Motorsports.Plugin.PitBox.FastRepairRequested',
  'K10Motorsports.Plugin.PitBox.WindshieldRequested',
  'K10Motorsports.Plugin.PitBox.FuelDisplay',
  'K10Motorsports.Plugin.PitBox.PressureLF',
  'K10Motorsports.Plugin.PitBox.PressureRF',
  'K10Motorsports.Plugin.PitBox.PressureLR',
  'K10Motorsports.Plugin.PitBox.PressureRR',
  // Car-specific adjustment availability
  'K10Motorsports.Plugin.PitBox.HasTC',
  'K10Motorsports.Plugin.PitBox.HasABS',
  'K10Motorsports.Plugin.PitBox.HasARBFront',
  'K10Motorsports.Plugin.PitBox.HasARBRear',
  'K10Motorsports.Plugin.PitBox.HasEnginePower',
  'K10Motorsports.Plugin.PitBox.HasFuelMixture',
  'K10Motorsports.Plugin.PitBox.HasWeightJackerL',
  'K10Motorsports.Plugin.PitBox.HasWeightJackerR',
  'K10Motorsports.Plugin.PitBox.HasWingFront',
  'K10Motorsports.Plugin.PitBox.HasWingRear',
  // Additional car adjustments
  'DataCorePlugin.GameRawData.Telemetry.dcEnginePower',
  'DataCorePlugin.GameRawData.Telemetry.dcFuelMixture',
  'DataCorePlugin.GameRawData.Telemetry.dcWeightJackerLeft',
  'DataCorePlugin.GameRawData.Telemetry.dcWeightJackerRight',
  'DataCorePlugin.GameRawData.Telemetry.dcWingFront',
  'DataCorePlugin.GameRawData.Telemetry.dcWingRear'
];

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE VARIABLES
// ═══════════════════════════════════════════════════════════════

// Polling & connection
let _pollFrame = 0;
let _pollActive = false;
let _latestSnapshot = null;
let _snapshotDirty = false;
let _connFails = 0;
let _backoffUntil = 0;
let _hasEverConnected = false;
let _settingsForcedByDisconnect = false;

// Game & session state
let _currentGameId = '';
let _isIRacing = true;
let _isRally = false;
let _rallyModeEnabled = false;
let _isIdle = true;
let _cycleFrameCount = 0;
let _cycleLastSwitch = 0;
let _prevLap = 0;

// Driver & car state
let _driverDisplayName = 'YOU';
let _lastCarModel = null;
let _lastDriverAhead = '';
let _lastDriverBehind = '';
let _lastPosition = 0;
let _gapsBestLap = 0;          // best lap time for gaps module (non-race)
let _gapsLastLap = 0;          // last completed lap for gaps module
let _gapsWorstLap = 0;         // worst valid lap time for gaps module
let _gapsLapNum = 0;           // current lap number for gaps module
let _gapsNonRaceMode = false;  // currently in non-race session
let _lapStartIncidents = 0;   // incident count at start of current lap (for invalid detection)
let _lapInvalid = false;       // true when incidents increased during current lap
let _prevSectorSplits = [];    // previous poll's sector splits — survives iRacing clearing on lap cross
let _startPosition = 0;
let _prevBB = -1, _prevTC = -1, _prevABS = -1;
let _clutchSeenActive = false;
let _clutchHidden = false;

// Session change detection (resets event history, timeline, etc.)
let _prevSessionTypeName = '';

// Manufacturer country flag trigger state
let _mfrFlagShownThisSession = false;  // prevent re-trigger within same session
let _mfrFlagPrevSessState = 0;         // previous grid SessionState
let _mfrFlagPrevInPit = true;          // previous pit lane state
let _mfrFlagPrevCompletedLaps = 0;     // previous completed laps

// Flag & race control
let _lastFlagState = 'none';
let _greenFlagTimeout = null;
let _rcTimeout = null;
let _rcVisible = false;
let _flagHoldUntil = 0;
let _flagHoldState = 'none';
let _prevCheckered = false;
let _forceFlagState = '';

// Race end screen
let _raceEndVisible = false;
let _raceEndTimer = null;

// Timer & UI
let _timerHideTimeout = null;
let _timerPinned = false;
let _commentaryWasVisible = false;
let _strategyWasVisible = false;
let _tcSeen = false;
let _absSeen = false;
let _carAdj = null;  // result from getCarAdjustability() for current car
let _tcFlashFrames = 0;   // TC active glow countdown (frames)
let _absFlashFrames = 0;  // ABS active glow countdown (frames)

// Grid / Formation
let _gridActive = false;
let _gridLightsPhase = 0;
let _gridPrevSessionState = 4;
let _gridFadeTimer = null;

// Cycles & animations
const _cycleIntervalFrames = Math.round(10000 / POLL_MS); // 10s

// ═══════════════════════════════════════════════════════════════
// DEMO MODE MODELS
// ═══════════════════════════════════════════════════════════════

const _demoModels = {
  bmw:'M4 GT3', mclaren:'720S GT3', mazda:'MX-5 Cup', nissan:'GTP ZX-T',
  dallara:'IR-04', ferrari:'296 GT3', porsche:'911 GT3 R', audi:'R8 LMS',
  mercedes:'AMG GT3', lamborghini:'Huracán GT3', chevrolet:'Corvette Z06',
  ford:'Mustang GT3', toyota:'GR86', hyundai:'Elantra N TC',
  cadillac:'V-Series.R', astonmartin:'Vantage GT3', lotus:'Emira GT4',
  honda:'Civic Type R', ligier:'JS P320'
};

// ═══════════════════════════════════════════════════════════════
// MANUFACTURER BRANDING
// ═══════════════════════════════════════════════════════════════

const _defaultLogoBg = 'hsla(0, 0%, 12%, 1.0)';

const _mfrBrandColors = {
  bmw:         'hsla(204, 100%, 45%, 0.55)',
  mclaren:     'hsla(24, 100%, 52%, 0.55)',
  mazda:       'hsla(0, 90%, 44%, 0.55)',
  nissan:      'hsla(0, 85%, 50%, 0.55)',
  dallara:     'hsla(210, 85%, 48%, 0.55)',
  ferrari:     'hsla(0, 90%, 48%, 0.55)',
  porsche:     'hsla(0, 0%, 50%, 0.50)',
  audi:        'hsla(0, 0%, 50%, 0.50)',
  mercedes:    'hsla(175, 65%, 42%, 0.52)',
  lamborghini: 'hsla(48, 90%, 48%, 0.52)',
  chevrolet:   'hsla(40, 62%, 38%, 0.55)',
  ford:        'hsla(237, 100%, 28%, 0.55)',
  toyota:      'hsla(0, 85%, 48%, 0.55)',
  hyundai:     'hsla(216, 85%, 45%, 0.55)',
  cadillac:    'hsla(0, 0%, 50%, 0.50)',
  astonmartin: 'hsla(155, 70%, 38%, 0.55)',
  lotus:       'hsla(57, 100%, 50%, 0.55)',
  ligier:      'hsla(204, 78%, 40%, 0.55)',
  fia:         'hsla(228, 73%, 21%, 0.55)',
  radical:     'hsla(43, 82%, 57%, 0.55)',
  honda:       'hsla(0, 90%, 42%, 0.55)'
};

// Manufacturer → ISO 3166-1 alpha-2 country code (used for flag display)
const _mfrCountry = {
  bmw: 'DE', mclaren: 'GB', mazda: 'JP', nissan: 'JP',
  dallara: 'IT', ferrari: 'IT', porsche: 'DE', audi: 'DE',
  mercedes: 'DE', lamborghini: 'IT', chevrolet: 'US', ford: 'US',
  toyota: 'JP', hyundai: 'KR', cadillac: 'US', astonmartin: 'GB',
  lotus: 'GB', honda: 'JP', ligier: 'FR', fia: 'FR', radical: 'GB'
};

const _mfrMap = {
  'bmw':'bmw', 'm4 gt':'bmw', 'm8 gte':'bmw', 'm hybrid':'bmw',
  'mclaren':'mclaren', 'mp4':'mclaren',
  'mazda':'mazda', 'mx-5':'mazda', 'miata':'mazda',
  'nissan':'nissan', 'gtp zx':'nissan', 'nismo':'nissan',
  'fia f4':'fia', 'fia':'fia',
  'dallara':'dallara', 'ir-01':'dallara', 'ir01':'dallara', 'ir-04':'dallara', 'ir04':'dallara',
  'ferrari':'ferrari', '488':'ferrari', '296':'ferrari', 'sf-23':'ferrari',
  'porsche':'porsche', '911':'porsche', 'cayman':'porsche', 'boxter':'porsche', '918':'porsche',
  'audi':'audi', 'r8':'audi', 'rs e-tron gt':'audi', 'e-tron gt':'audi',
  'mercedes':'mercedes', 'amg gt':'mercedes', 'hypercar':'mercedes',
  'lamborghini':'lamborghini', 'huracán':'lamborghini', 'huracan':'lamborghini', 'urus':'lamborghini',
  'chevrolet':'chevrolet', 'corvette':'chevrolet', 'chevy':'chevrolet', 'c8':'chevrolet',
  'ford':'ford', 'mustang':'ford', 'ford gt':'ford', 'mk iv':'ford',
  'toyota':'toyota', 'gr86':'toyota', 'gr corolla':'toyota',
  'hyundai':'hyundai', 'elantra':'hyundai', 'ioniq':'hyundai',
  'cadillac':'cadillac', 'v-series':'cadillac',
  'aston martin':'astonmartin', 'vantage':'astonmartin', 'dbs':'astonmartin',
  'lotus':'lotus', 'emira':'lotus', 'evija':'lotus',
  'honda':'honda', 'civic':'honda', 'nsx':'honda',
  'ligier':'ligier', 'js p3':'ligier', 'js p320':'ligier',
  'radical':'radical', 'sr10':'radical', 'sr8':'radical', 'sr3':'radical',
  'generic':'generic', 'none':'none'
};

/** Match a car model string to a manufacturer key in _mfrMap */
function detectMfr(model) {
  if (!model) return 'none';
  const l = ('' + model).toLowerCase();
  for (const k in _mfrMap) { if (l.indexOf(k) !== -1) return _mfrMap[k]; }
  return 'generic';
}

// ═══════════════════════════════════════════════════════════════
// CAR ADJUSTABILITY — cars that truly lack BB/ABS/TC systems
// These cars physically don't have the system, so we HIDE the module.
// Cars not listed here that report 0 are assumed FIXED (setup-locked).
// Each entry: substring match → { noBB, noABS, noTC, absNoAdjust }
// absNoAdjust: true = ABS exists but isn't adjustable by driver (show when active)
// noABS: true = no ABS system at all (hide completely)
// ═══════════════════════════════════════════════════════════════
const _carNoAdjust = [
  // Formula / Open-wheel (no ABS, no TC in almost all)
  { match: 'formula vee',      noBB: false, noABS: true, noTC: true },
  { match: 'skip barber',      noBB: false, noABS: true, noTC: true },
  { match: 'usf 2000',         noBB: false, noABS: true, noTC: true },
  { match: 'usf2000',          noBB: false, noABS: true, noTC: true },
  { match: 'indy pro 2000',    noBB: false, noABS: true, noTC: true },
  { match: 'formula 4',        noBB: false, noABS: true, noTC: true },
  { match: 'fia f4',           noBB: false, noABS: true, noTC: true },
  { match: 'ir-04',            noBB: false, noABS: true, noTC: true },
  { match: 'dallara f3',       noBB: false, noABS: true, noTC: true },
  { match: 'lotus 49',         noBB: true,  noABS: true, noTC: true },
  { match: 'lotus 79',         noBB: false, noABS: true, noTC: true },
  { match: 'mp4-30',           noBB: false, noABS: true, noTC: true },
  { match: 'w12',              noBB: false, noABS: true, noTC: true },
  { match: 'w13',              noBB: false, noABS: true, noTC: true },
  // LMP / Prototype (no ABS typically)
  { match: 'js p320',          noBB: false, noABS: true, noTC: false },
  { match: 'ligier js',        noBB: false, noABS: true, noTC: false },
  // Porsche Cup (no ABS, no TC on 992.1)
  { match: '992 cup',          noBB: false, noABS: true, noTC: true },
  { match: 'gt3 cup',          noBB: false, noABS: true, noTC: true },
  // V8 Supercars (no ABS, no TC)
  { match: 'supercars',        noBB: false, noABS: true, noTC: true },
  { match: 'supercar',         noBB: false, noABS: true, noTC: true },
  { match: 'ford falcon',      noBB: false, noABS: true, noTC: true },
  { match: 'holden commodore',  noBB: false, noABS: true, noTC: true },
  { match: 'gen3 camaro',      noBB: false, noABS: true, noTC: true },
  { match: 'gen3 mustang',     noBB: false, noABS: true, noTC: true },
  // Vintage / spec
  { match: 'spec racer',       noBB: false, noABS: true, noTC: true },
  { match: 'legends',          noBB: true,  noABS: true, noTC: true },
  { match: '34 ford',          noBB: true,  noABS: true, noTC: true },
  // Production-based (ABS exists but not adjustable, no TC in iRacing implementation)
  { match: 'mx-5 cup',         noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'mx-5 roadster',    noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'mx-5',             noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'gr86',             noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  { match: 'solstice',         noBB: false, noABS: false, absNoAdjust: true, noTC: true },
  // NASCAR / Oval (no ABS, no TC)
  { match: 'nascar',           noBB: false, noABS: true, noTC: true },
  { match: 'gen 6',            noBB: false, noABS: true, noTC: true },
  { match: 'next gen',         noBB: false, noABS: true, noTC: true },
  { match: 'trucks',           noBB: false, noABS: true, noTC: true },
  { match: 'street stock',     noBB: true,  noABS: true, noTC: true },
  { match: 'late model',       noBB: false, noABS: true, noTC: true },
  { match: 'modified',         noBB: false, noABS: true, noTC: true },
  { match: 'silver crown',     noBB: false, noABS: true, noTC: true },
  { match: 'sprint car',       noBB: false, noABS: true, noTC: true },
  { match: 'midget',           noBB: false, noABS: true, noTC: true },
  { match: 'dirt',             noBB: false, noABS: true, noTC: true },
];

/** Check car model string against no-adjust list. Returns {noBB, noABS, noTC} or null. */
function getCarAdjustability(model) {
  if (!model) return null;
  const l = ('' + model).toLowerCase();
  for (const entry of _carNoAdjust) {
    if (l.indexOf(entry.match) !== -1) return entry;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS SYSTEM
// ═══════════════════════════════════════════════════════════════

const _defaultSettings = {
  logoOnlyStart: true, // Start in logo-only mode; HUD reveals when session goes active
  showFuel: true, showTyres: true, showControls: true, showPedals: true,
  showMaps: true, showPosition: true, showTacho: true, showCommentary: true,
  showK10Logo: true, showCarLogo: true, showGameLogo: true, simhubUrl: 'http://localhost:8889/k10mediabroadcaster/',
  layoutPosition: 'top-right',
  greenScreen: false, showWebGL: true, showBonkers: true, ambientMode: 'reflective',
  zoom: 165, forceFlag: '', showLeaderboard: true, showDatastream: true, showPitBox: true, showIncidents: true, showSpotter: true,
  incPenalty: 17, incDQ: 25,
  discordUser: null,
  rallyMode: false,
  driveMode: false,
  // Visual modes and effects
  visualPreset: 'standard',  // 'standard', 'minimal', 'minimal-plus'
  showBorders: true,
  showSentimentHalo: true,
  showCommentaryGlow: true,
  showRcAnimation: true,
  showMapGlow: true,
  showRedlineFlash: true,
  // Leaderboard
  lbFocus: 'me',        // 'me' = center on player, 'lead' = show from P1
  lbMaxRows: 10,        // max visible opponent rows (increased from 5 to show more of full field)
  lbExpandToFill: false, // override lbMaxRows to fill available screen space
  // Datastream field toggles
  dsShowGforce: true,
  dsShowYaw: true,
  dsShowFfb: true,
  dsShowDelta: true,
  dsShowTrackTemp: true,
  dsShowFps: true,
  // Y-offset for bottom-positioned modules
  bottomYOffset: 0,
  // Logo subtitle text
  logoSubtitle: '',
  // AI Race Coach
  agentKey: ''
};

let _settings = Object.assign({}, _defaultSettings);

// Discord state
let _discordUser = null;

// K10 Pro Drive state (set by connections.js on startup)
// Declared here so game-detect.js and other early scripts can reference it
let _k10User = null;
let _k10Features = [];

// Logo cycling
let _currentCarLogoIdx = 0;
let _currentCarLogo = '';
let _logoCycleTimer = null;  // Will be initialized when car-logos.js runs

// ─── Utility: session type detection ───
function _isNonRaceSession(sessionType) {
  if (!sessionType) return false;
  const s = sessionType.toLowerCase();
  return s.includes('practice') || s.includes('qualify') || s.includes('test') || s.includes('warmup') || s.includes('warm up');
}

// ─── Utility: format lap time (seconds → m:ss.xxx) ───
function _fmtLapTime(secs) {
  if (secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
