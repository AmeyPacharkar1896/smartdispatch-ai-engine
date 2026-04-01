import { useState, useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import BatchEvalTab from './BatchEvalTab'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Greater Mumbai bounds (all locations must be inside)
const MUMBAI_BOUNDS = { latMin: 18.88, latMax: 19.28, lngMin: 72.78, lngMax: 73.05 }
const NUM_DRIVERS = 12
const NUM_DRIVERS_NEAR_PICKUP = 9
const NEAR_PICKUP_RADIUS_KM = 4

type LatLng = { lat: number; lng: number }

/** Parcel tiers — weight & volume feed the pricing API; factors shape the itemized bill. */
type ParcelCategory = {
  id: string
  label: string
  subtitle: string
  weightKg: number
  volumeL: number
  handlingInr: number
  distanceMultiplier: number
}

const PARCEL_CATEGORIES: ParcelCategory[] = [
  {
    id: 'envelope',
    label: 'Micro / documents',
    subtitle: 'Envelopes, flats, A4 — up to 0.25 kg',
    weightKg: 0.15,
    volumeL: 0.4,
    handlingInr: 0,
    distanceMultiplier: 1.0,
  },
  {
    id: 'small',
    label: 'Small parcel',
    subtitle: 'Shoe-box size — up to ~2 kg',
    weightKg: 1.2,
    volumeL: 4,
    handlingInr: 18,
    distanceMultiplier: 1.1,
  },
  {
    id: 'standard',
    label: 'Standard box',
    subtitle: 'Typical e-commerce carton',
    weightKg: 4,
    volumeL: 18,
    handlingInr: 42,
    distanceMultiplier: 1.28,
  },
  {
    id: 'large',
    label: 'Large shipment',
    subtitle: 'Appliances, bulk cartons',
    weightKg: 12,
    volumeL: 55,
    handlingInr: 78,
    distanceMultiplier: 1.52,
  },
  {
    id: 'oversized',
    label: 'Heavy / oversized',
    subtitle: 'Two-person lift, pallet edge',
    weightKg: 28,
    volumeL: 140,
    handlingInr: 165,
    distanceMultiplier: 1.88,
  },
]

const BASE_FARE_INR = 45
const PER_KM_INR = 12
const GST_RATE = 0.18

/**
 * OSRM / travel ML durations are free-flow biased. Scale + floor so ETAs match believable
 * Mumbai door-to-door driving (signals, junctions, mixed traffic), before the congestion slider.
 */
const MUMBAI_ETA_REALISM_MULT = 1.62
const MUMBAI_ETA_MIN_MIN_PER_KM = 1.9
/** Handover, parking, and first/last metre — added only to the congestion-adjusted ETA shown on the bill. */
const ETA_FINAL_BUFFER_MIN = 7

function calibrateMumbaiDisplayEta(engineMinutes: number | null, distanceKm: number): number | null {
  if (engineMinutes == null || engineMinutes <= 0 || distanceKm <= 0) return null
  const scaled = engineMinutes * MUMBAI_ETA_REALISM_MULT
  const floorByKm = distanceKm * MUMBAI_ETA_MIN_MIN_PER_KM
  return round2(Math.max(scaled, floorByKm))
}

type UrgencyId = 'normal' | 'express' | 'same_day'

const URGENCY_OPTIONS: { id: UrgencyId; label: string; shortLabel: string; surchargeRate: number }[] = [
  { id: 'normal', label: 'Standard', shortLabel: 'Standard', surchargeRate: 0 },
  { id: 'express', label: 'Express', shortLabel: 'Express', surchargeRate: 0.14 },
  { id: 'same_day', label: 'Same-day', shortLabel: 'Same-day', surchargeRate: 0.32 },
]

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function trafficFactorFromCongestion(congestion0to100: number): number {
  return round2(1 + Math.min(100, Math.max(0, congestion0to100)) * 0.008)
}

function congestionLabel(c: number): string {
  if (c < 22) return 'Light'
  if (c < 45) return 'Moderate'
  if (c < 70) return 'Heavy'
  return 'Severe'
}

function getEffectiveSimClock(
  useCustom: boolean,
  simHour: number,
  simDow: number,
): { hour: number; dayOfWeek: number; clockLabel: string } {
  if (useCustom) {
    const h = Math.min(23, Math.max(0, simHour))
    const dow = Math.min(6, Math.max(0, simDow))
    return {
      hour: h,
      dayOfWeek: dow,
      clockLabel: `${WEEKDAY_LABELS[dow]} ${String(h).padStart(2, '0')}:00 IST · simulated`,
    }
  }
  const now = new Date()
  const js = now.getDay()
  const dow = js === 0 ? 6 : js - 1
  return {
    hour: now.getHours(),
    dayOfWeek: dow,
    clockLabel:
      now.toLocaleString('en-IN', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      }) + ' IST · live',
  }
}

function animationMsFromSim(trafficFactor: number, urgency: UrgencyId): number {
  let ms = Math.round(4600 * trafficFactor)
  if (urgency === 'express') ms = Math.round(ms * 0.86)
  else if (urgency === 'same_day') ms = Math.round(ms * 0.9)
  return Math.min(22_000, Math.max(3200, ms))
}

type BillDetails = {
  invoiceId: string
  placedAtIso: string
  pickupName: string
  destName: string
  category: ParcelCategory
  distanceKm: number
  distanceSource: 'api' | 'estimated'
  baseFareInr: number
  distancePortionBaseInr: number
  trafficPremiumInr: number
  distanceChargeInr: number
  handlingInr: number
  urgency: UrgencyId
  urgencyLabel: string
  urgencyFeeInr: number
  trafficCongestion: number
  trafficFactor: number
  demandScore: number
  demandSurgeInr: number
  subtotalInr: number
  gstInr: number
  totalInr: number
  mlSuggestedInr: number | null
  mlDurationMin: number | null
  etaFreeFlowMin: number | null
  etaTrafficAdjustedMin: number | null
  simClockLabel: string
  congestionLabel: string
  animationDurationMs: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatInr(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n)
}

function buildBill(
  category: ParcelCategory,
  pickupName: string,
  destName: string,
  distanceKm: number,
  source: 'api' | 'estimated',
  mlSuggested: number | null,
  mlDurationMin: number | null,
  opts: {
    urgency: UrgencyId
    trafficCongestion: number
    demandScore: number
    simClockLabel: string
  },
): BillDetails {
  const uMeta = URGENCY_OPTIONS.find((o) => o.id === opts.urgency) ?? URGENCY_OPTIONS[0]
  const trafficFactor = trafficFactorFromCongestion(opts.trafficCongestion)
  const congLabel = congestionLabel(opts.trafficCongestion)

  const baseFareInr = BASE_FARE_INR
  const distancePortionBaseInr = round2(distanceKm * PER_KM_INR * category.distanceMultiplier)
  const trafficPremiumInr = round2(distancePortionBaseInr * (trafficFactor - 1))
  const distanceChargeInr = round2(distancePortionBaseInr + trafficPremiumInr)
  const handlingInr = category.handlingInr

  const preUrgency = round2(baseFareInr + distanceChargeInr + handlingInr)
  const urgencyFeeInr = round2(preUrgency * uMeta.surchargeRate)
  const preDemand = round2(preUrgency + urgencyFeeInr)
  const demandSurgeInr =
    opts.demandScore > 1.01 ? round2(preDemand * (opts.demandScore - 1) * 0.2) : 0

  const subtotalInr = round2(preDemand + demandSurgeInr)
  const gstInr = round2(subtotalInr * GST_RATE)
  const totalInr = round2(subtotalInr + gstInr)

  const etaCalibrated = calibrateMumbaiDisplayEta(mlDurationMin, distanceKm)
  const etaFreeFlowMin = etaCalibrated
  const etaTrafficAdjustedMin =
    etaCalibrated != null
      ? round2(etaCalibrated * trafficFactor + ETA_FINAL_BUFFER_MIN)
      : null

  return {
    invoiceId: `SD-MUM-${Date.now().toString(36).toUpperCase()}`,
    placedAtIso: new Date().toISOString(),
    pickupName,
    destName,
    category,
    distanceKm: round2(distanceKm),
    distanceSource: source,
    baseFareInr,
    distancePortionBaseInr,
    trafficPremiumInr,
    distanceChargeInr,
    handlingInr,
    urgency: opts.urgency,
    urgencyLabel: uMeta.label,
    urgencyFeeInr,
    trafficCongestion: opts.trafficCongestion,
    trafficFactor,
    demandScore: round2(opts.demandScore),
    demandSurgeInr,
    subtotalInr,
    gstInr,
    totalInr,
    mlSuggestedInr: mlSuggested != null ? round2(mlSuggested) : null,
    mlDurationMin: mlDurationMin != null ? round2(mlDurationMin) : null,
    etaFreeFlowMin,
    etaTrafficAdjustedMin,
    simClockLabel: opts.simClockLabel,
    congestionLabel: congLabel,
    animationDurationMs: animationMsFromSim(trafficFactor, opts.urgency),
  }
}

async function fetchRouteMetrics(
  from: LatLng,
  to: LatLng,
): Promise<{ distanceKm: number; durationMin: number } | null> {
  try {
    const url = `${API_BASE}/distance?origin_lat=${from.lat}&origin_lng=${from.lng}&dest_lat=${to.lat}&dest_lng=${to.lng}`
    const res = await fetch(url)
    const data = (await res.json().catch(() => ({}))) as { distance_km?: number; duration_min?: number }
    if (!res.ok || typeof data.distance_km !== 'number') return null
    const durationMin =
      typeof data.duration_min === 'number' ? data.duration_min : Math.round(data.distance_km * 2.25 * 100) / 100
    return { distanceKm: data.distance_km, durationMin }
  } catch {
    return null
  }
}

async function fetchMlPrice(
  category: ParcelCategory,
  distanceKm: number,
  urgency: UrgencyId,
  hour: number,
  dayOfWeek: number,
  demandScore: number,
): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      distance_km: String(distanceKm),
      weight_kg: String(category.weightKg),
      volume_l: String(category.volumeL),
      urgency,
      hour: String(hour),
      day_of_week: String(dayOfWeek),
      demand_score: String(round2(demandScore)),
    })
    const res = await fetch(`${API_BASE}/predict/price?${params}`)
    const data = (await res.json().catch(() => ({}))) as { price_inr?: number }
    if (!res.ok || typeof data.price_inr !== 'number') return null
    return data.price_inr
  } catch {
    return null
  }
}

async function fetchMlDuration(distanceKm: number, hour: number, dayOfWeek: number): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      distance_km: String(distanceKm),
      hour: String(hour),
      day_of_week: String(dayOfWeek),
    })
    const res = await fetch(`${API_BASE}/predict/duration?${params}`)
    const data = (await res.json().catch(() => ({}))) as { duration_min?: number }
    if (!res.ok || typeof data.duration_min !== 'number') return null
    return data.duration_min
  } catch {
    return null
  }
}

/** Named places in Greater Mumbai (from OSM/BBBike area). All coordinates inside Mumbai bounds. */
const MUMBAI_PLACES: { id: string; name: string; lat: number; lng: number }[] = [
  { id: 'bandra', name: 'Bandra', lat: 19.0596, lng: 72.8341 },
  { id: 'andheri', name: 'Andheri', lat: 19.1136, lng: 72.8491 },
  { id: 'dadar', name: 'Dadar', lat: 19.076, lng: 72.8777 },
  { id: 'colaba', name: 'Colaba', lat: 18.9388, lng: 72.8354 },
  { id: 'mahalaxmi', name: 'Mahalaxmi', lat: 19.0176, lng: 72.8562 },
  { id: 'parel', name: 'Parel', lat: 19.0825, lng: 72.8821 },
  { id: 'bhandup', name: 'Bhandup', lat: 19.1334, lng: 72.913 },
  { id: 'borivali', name: 'Borivali', lat: 19.1998, lng: 72.8414 },
  { id: 'lower-parel', name: 'Lower Parel', lat: 19.0703, lng: 72.8692 },
  { id: 'malabar-hill', name: 'Malabar Hill', lat: 18.9926, lng: 72.8291 },
  { id: 'grant-road', name: 'Grant Road', lat: 19.0215, lng: 72.8424 },
  { id: 'currey-road', name: 'Currey Road', lat: 19.0896, lng: 72.8656 },
  { id: 'juhu', name: 'Juhu', lat: 19.0027, lng: 72.8025 },
  { id: 'kandivali', name: 'Kandivali', lat: 19.1688, lng: 72.8591 },
  { id: 'dahisar', name: 'Dahisar', lat: 19.2193, lng: 72.8378 },
  { id: 'cuffe-parade', name: 'Cuffe Parade', lat: 18.9447, lng: 72.8274 },
  { id: 'byculla', name: 'Byculla', lat: 19.0748, lng: 72.8826 },
  { id: 'vile-parle', name: 'Vile Parle', lat: 19.0021, lng: 72.819 },
]

/** Road-side points in Mumbai (OSM/research coords) so drivers land on roads, not water. */
const ROAD_POINTS: LatLng[] = [
  ...MUMBAI_PLACES.map((p) => ({ lat: p.lat, lng: p.lng })),
  { lat: 19.0554, lng: 72.8781 },
  { lat: 19.0027, lng: 72.8025 },
  { lat: 19.1688, lng: 72.8591 },
  { lat: 19.2193, lng: 72.8378 },
  { lat: 18.9447, lng: 72.8274 },
  { lat: 19.0748, lng: 72.8826 },
  { lat: 19.0021, lng: 72.819 },
  { lat: 19.018, lng: 72.842 },
  { lat: 19.065, lng: 72.871 },
  { lat: 19.098, lng: 72.848 },
  { lat: 19.042, lng: 72.818 },
  { lat: 19.151, lng: 72.892 },
  { lat: 18.96, lng: 72.831 },
  { lat: 19.185, lng: 72.855 },
]

function isInMumbai(lat: number, lng: number): boolean {
  return (
    lat >= MUMBAI_BOUNDS.latMin &&
    lat <= MUMBAI_BOUNDS.latMax &&
    lng >= MUMBAI_BOUNDS.lngMin &&
    lng <= MUMBAI_BOUNDS.lngMax
  )
}

function getPlaceById(id: string): (typeof MUMBAI_PLACES)[0] {
  return MUMBAI_PLACES.find((p) => p.id === id) ?? MUMBAI_PLACES[0]
}

function distKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dlat = (Math.PI / 180) * (b.lat - a.lat)
  const dlng = (Math.PI / 180) * (b.lng - a.lng)
  const x = Math.sin(dlat / 2) ** 2 + Math.cos((Math.PI / 180) * a.lat) * Math.cos((Math.PI / 180) * b.lat) * Math.sin(dlng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function estimateRoadDistanceKm(from: LatLng, to: LatLng): number {
  return round2(distKm(from, to) * 1.34)
}

/** Small radial jitter (~20 m max) so markers stay near road POIs without landing in water/parks. */
const ROAD_JITTER_DEG = 0.00018

function generateDrivers(pickup: LatLng): LatLng[] {
  const withDist = ROAD_POINTS.map((p) => ({ point: p, d: distKm(p, pickup) }))
  const near = withDist.filter((x) => x.d <= NEAR_PICKUP_RADIUS_KM).map((x) => x.point)
  const far = withDist.filter((x) => x.d > NEAR_PICKUP_RADIUS_KM).map((x) => x.point)
  const poolNear = near.length > 0 ? near : ROAD_POINTS
  const poolFar = far.length > 0 ? far : ROAD_POINTS

  const out: LatLng[] = []
  const nNear = Math.min(NUM_DRIVERS_NEAR_PICKUP, poolNear.length * 2)
  for (let i = 0; i < NUM_DRIVERS; i++) {
    const isNear = i < nNear
    const pool = isNear ? poolNear : poolFar
    const base = pool[Math.floor(Math.random() * pool.length)]
    const r = Math.random() * ROAD_JITTER_DEG
    const theta = Math.random() * 2 * Math.PI
    const cosLat = Math.cos((Math.PI / 180) * base.lat)
    const dlat = r * Math.cos(theta)
    const dlng = (r * Math.sin(theta)) / Math.max(0.2, cosLat)
    out.push({
      lat: Math.max(MUMBAI_BOUNDS.latMin, Math.min(MUMBAI_BOUNDS.latMax, base.lat + dlat)),
      lng: Math.max(MUMBAI_BOUNDS.lngMin, Math.min(MUMBAI_BOUNDS.lngMax, base.lng + dlng)),
    })
  }
  return out
}

function nearestDriverTo(drivers: LatLng[], point: LatLng): number {
  let best = 0
  let bestD = distKm(drivers[0], point)
  for (let i = 1; i < drivers.length; i++) {
    const d = distKm(drivers[i], point)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

type SimPhase =
  | 'idle'
  | 'order_placed'
  | 'driver_assigned'
  | 'driver_to_pickup'
  | 'picked_up'
  | 'driver_to_dest'
  | 'delivered'

const PHASE_LABELS: Record<SimPhase, string> = {
  idle: 'Ready to simulate',
  order_placed: '📦 Order placed — Waiting for driver',
  driver_assigned: '🚗 Driver assigned — Heading to pickup',
  driver_to_pickup: '🚗 Driver en route to pickup...',
  picked_up: '✅ Package picked up — Heading to destination',
  driver_to_dest: '🚗 Driver en route to delivery...',
  delivered: '✅ Delivered!',
}

function interpolate(from: LatLng, to: LatLng, t: number): LatLng {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  }
}

/** Interpolate position along a polyline; t in [0, 1]. */
function interpolateAlongPath(path: LatLng[], t: number): LatLng {
  if (!path.length) return path[0] || { lat: 0, lng: 0 }
  if (path.length === 1 || t <= 0) return path[0]
  if (t >= 1) return path[path.length - 1]
  const i = t * (path.length - 1)
  const idx = Math.floor(i)
  const frac = i - idx
  return interpolate(path[idx], path[idx + 1], frac)
}

async function fetchRoute(from: LatLng, to: LatLng): Promise<{ path: LatLng[] | null; error: string | null }> {
  try {
    const url = `${API_BASE}/route?origin_lat=${from.lat}&origin_lng=${from.lng}&dest_lat=${to.lat}&dest_lng=${to.lng}&overview=true`
    const res = await fetch(url)
    const data = await res.json().catch(() => ({}))
    const coords = (data?.coordinates || []) as { lat: number; lng: number }[]
    if (!res.ok) {
      return { path: null, error: res.status === 404 ? 'No route found' : 'Route API error' }
    }
    return { path: coords.length > 0 ? coords : null, error: null }
  } catch {
    return { path: null, error: 'Route API unavailable — using straight line' }
  }
}

const DEFAULT_PICKUP_ID = 'dadar'
const DEFAULT_DEST_ID = 'andheri'

type MainTab = 'delivery' | 'batch'

export default function App() {
  const [mainTab, setMainTab] = useState<MainTab>('delivery')
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<{ pickup?: L.Marker; dest?: L.Marker; driver?: L.Marker; idleDrivers: L.Marker[] }>({ idleDrivers: [] })
  const polylineRef = useRef<L.Polyline | null>(null)
  const routePathRef = useRef<LatLng[] | null>(null)
  const animationDurationMsRef = useRef(4800)

  const [drivers, setDrivers] = useState<LatLng[]>(() => generateDrivers(getPlaceById(DEFAULT_PICKUP_ID)))

  const [pickupPlaceId, setPickupPlaceId] = useState(DEFAULT_PICKUP_ID)
  const [destPlaceId, setDestPlaceId] = useState(DEFAULT_DEST_ID)
  const pickupLocation = useMemo(() => {
    const p = getPlaceById(pickupPlaceId)
    return { lat: p.lat, lng: p.lng }
  }, [pickupPlaceId])
  const destLocation = useMemo(() => {
    const p = getPlaceById(destPlaceId)
    return { lat: p.lat, lng: p.lng }
  }, [destPlaceId])

  const [phase, setPhase] = useState<SimPhase>('idle')
  const [assignedDriverIndex, setAssignedDriverIndex] = useState<number | null>(null)
  const [driverPos, setDriverPos] = useState<LatLng>(() => getPlaceById(DEFAULT_PICKUP_ID))
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [routePath, setRoutePath] = useState<LatLng[] | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [parcelCategoryId, setParcelCategoryId] = useState(PARCEL_CATEGORIES[0].id)
  const [bill, setBill] = useState<BillDetails | null>(null)
  const [billLoading, setBillLoading] = useState(false)
  const [urgency, setUrgency] = useState<UrgencyId>('normal')
  const [trafficCongestion, setTrafficCongestion] = useState(40)
  const [demandScore, setDemandScore] = useState(1)
  const [useCustomSimTime, setUseCustomSimTime] = useState(false)
  const [simHour, setSimHour] = useState(18)
  const [simDow, setSimDow] = useState(2)

  // Initialize map (delivery tab only)
  useEffect(() => {
    if (mainTab !== 'delivery') return
    if (!mapRef.current || mapInstanceRef.current) return
    const map = L.map(mapRef.current).setView([19.135, 72.9], 12)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(map)
    mapInstanceRef.current = map
    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [mainTab])

  // Create custom icons
  const createIcon = (color: string, emoji: string) =>
    L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background: ${color};
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      ">${emoji}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    })

  // Update markers when phase changes (not on every driverPos frame)
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !markersRef.current) return

    const { pickup, dest, driver, idleDrivers } = markersRef.current

    // Cleanup old markers and polyline
    pickup?.remove()
    dest?.remove()
    driver?.remove()
    idleDrivers.forEach((m) => m.remove())
    markersRef.current.idleDrivers = []
    polylineRef.current?.remove()
    polylineRef.current = null

    if (phase === 'idle') return

    // Pickup marker (green)
    if (['order_placed', 'driver_assigned', 'driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const pickupName = getPlaceById(pickupPlaceId).name
      const m = L.marker([pickupLocation.lat, pickupLocation.lng], {
        icon: createIcon('#10b981', '📦'),
      })
        .addTo(map)
        .bindPopup(`Pickup: ${pickupName}`)
      markersRef.current.pickup = m
    }

    // Destination marker (red)
    if (['order_placed', 'driver_assigned', 'driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const destName = getPlaceById(destPlaceId).name
      const m = L.marker([destLocation.lat, destLocation.lng], {
        icon: createIcon('#ef4444', '🏁'),
      })
        .addTo(map)
        .bindPopup(`Destination: ${destName}`)
      markersRef.current.dest = m
    }

    // Idle drivers (grey): when order_placed show all; when driver_assigned show all except assigned
    if (['order_placed', 'driver_assigned'].includes(phase)) {
      const idleIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="background:#64748b;width:24px;height:24px;border-radius:50%;border:2px solid white;font-size:12px;display:flex;align-items:center;justify-content:center">🚗</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      })
      const list: L.Marker[] = []
      drivers.forEach((d, i) => {
        if (phase === 'driver_assigned' && i === assignedDriverIndex) return
        const m = L.marker([d.lat, d.lng], { icon: idleIcon }).addTo(map).bindPopup('Available driver')
        list.push(m)
      })
      markersRef.current.idleDrivers = list
    }

    // Assigned driver marker (blue)
    if (['driver_assigned', 'driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const m = L.marker([driverPos.lat, driverPos.lng], {
        icon: createIcon('#3b82f6', '🚗'),
      })
        .addTo(map)
        .bindPopup('Assigned driver')
      markersRef.current.driver = m
    }
  }, [phase, pickupLocation, destLocation, drivers, assignedDriverIndex, driverPos, pickupPlaceId, destPlaceId])

  // Draw route polyline when we have path (separate effect so we don't recreate markers on path update)
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    polylineRef.current?.remove()
    polylineRef.current = null
    const path = routePathRef.current?.length ? routePathRef.current : routePath
    if (path && path.length > 1 && ['driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const latLngs = path.map((p) => L.latLng(p.lat, p.lng))
      const line = L.polyline(latLngs, { color: '#3b82f6', weight: 4, opacity: 0.8 })
      line.addTo(map)
      polylineRef.current = line
    }
  }, [phase, routePath])

  // Update driver marker position during animation (avoid full re-creation)
  useEffect(() => {
    const driver = markersRef.current.driver
    if (driver) {
      driver.setLatLng([driverPos.lat, driverPos.lng])
    }
  }, [driverPos])

  // Animate driver movement (along route path when available, else straight line)
  useEffect(() => {
    if (!isRunning) return
    const durationMs = animationDurationMsRef.current
    const steps = 60
    const stepMs = durationMs / steps
    let step = 0

    if (phase === 'driver_to_pickup') {
      const to = pickupLocation
      const from = driverPos
      const id = setInterval(() => {
        step++
        const t = Math.min(step / steps, 1)
        setProgress(Math.round(t * 100))
        const pathNow = routePathRef.current
        const pos =
          pathNow && pathNow.length > 1 ? interpolateAlongPath(pathNow, t) : interpolate(from, to, t)
        setDriverPos(pos)
        if (t >= 1) {
          clearInterval(id)
          setPhase('picked_up')
          setDriverPos(pickupLocation)
          setProgress(100)
          setIsRunning(false)
        }
      }, stepMs)
      return () => clearInterval(id)
    }

    if (phase === 'driver_to_dest') {
      const from = pickupLocation
      const to = destLocation
      const id = setInterval(() => {
        step++
        const t = Math.min(step / steps, 1)
        setProgress(Math.round(t * 100))
        const pathNow = routePathRef.current
        const pos =
          pathNow && pathNow.length > 1 ? interpolateAlongPath(pathNow, t) : interpolate(from, to, t)
        setDriverPos(pos)
        if (t >= 1) {
          clearInterval(id)
          setPhase('delivered')
          setDriverPos(destLocation)
          setProgress(100)
          setIsRunning(false)
        }
      }, stepMs)
      return () => clearInterval(id)
    }
  }, [phase, isRunning, pickupLocation, destLocation])

  const samePlace = pickupPlaceId === destPlaceId
  const canStart = phase === 'idle' && !samePlace

  const startSimulation = async () => {
    if (samePlace) return
    setDrivers(generateDrivers(pickupLocation))
    setAssignedDriverIndex(null)
    setDriverPos(pickupLocation)
    setProgress(0)
    setRouteError(null)
    setRoutePath(null)
    routePathRef.current = null
    setBill(null)
    setBillLoading(true)
    setPhase('order_placed')

    const category = PARCEL_CATEGORIES.find((c) => c.id === parcelCategoryId) ?? PARCEL_CATEGORIES[0]
    const pickupName = getPlaceById(pickupPlaceId).name
    const destName = getPlaceById(destPlaceId).name
    const metrics = await fetchRouteMetrics(pickupLocation, destLocation)
    const distanceKm = metrics?.distanceKm ?? estimateRoadDistanceKm(pickupLocation, destLocation)
    const source: 'api' | 'estimated' = metrics != null ? 'api' : 'estimated'
    const clock = getEffectiveSimClock(useCustomSimTime, simHour, simDow)
    const [mlPrice, mlDur] = await Promise.all([
      fetchMlPrice(category, distanceKm, urgency, clock.hour, clock.dayOfWeek, demandScore),
      fetchMlDuration(distanceKm, clock.hour, clock.dayOfWeek),
    ])
    const travelBaseMin = mlDur ?? metrics?.durationMin ?? round2(distanceKm * 2.35)
    const billData = buildBill(category, pickupName, destName, distanceKm, source, mlPrice, travelBaseMin, {
      urgency,
      trafficCongestion,
      demandScore,
      simClockLabel: clock.clockLabel,
    })
    animationDurationMsRef.current = billData.animationDurationMs
    setBill(billData)
    setBillLoading(false)
  }

  const nextStep = async () => {
    if (phase === 'idle') {
      void startSimulation()
    } else if (phase === 'order_placed') {
      const nearest = nearestDriverTo(drivers, pickupLocation)
      setAssignedDriverIndex(nearest)
      setDriverPos(drivers[nearest])
      setPhase('driver_assigned')
    } else if (phase === 'driver_assigned') {
      setRouteError(null)
      const { path, error } = await fetchRoute(driverPos, pickupLocation)
      routePathRef.current = path
      setRoutePath(path || [])
      setRouteError(error)
      setPhase('driver_to_pickup')
      setIsRunning(true)
    } else if (phase === 'picked_up') {
      setRouteError(null)
      const { path, error } = await fetchRoute(pickupLocation, destLocation)
      routePathRef.current = path
      setRoutePath(path || [])
      setRouteError(error)
      setPhase('driver_to_dest')
      setIsRunning(true)
    } else if (phase === 'delivered') {
      setPhase('idle')
      setRoutePath(null)
      routePathRef.current = null
      setBill(null)
    }
  }

  const resetSimulation = () => {
    setPhase('idle')
    setAssignedDriverIndex(null)
    setDriverPos(pickupLocation)
    setProgress(0)
    setIsRunning(false)
    setRoutePath(null)
    setRouteError(null)
    routePathRef.current = null
    setBill(null)
    setBillLoading(false)
  }

  const canAutoAdvance = phase === 'driver_to_pickup' || phase === 'driver_to_dest'

  return (
    <div className="app">
      <header className="header">
        <div className="header-titles">
          <h1>SmartDispatch</h1>
          <span className="subtitle">Delivery Simulation</span>
        </div>
        <nav className="header-tabs" aria-label="Main views">
          <button
            type="button"
            className={`header-tab ${mainTab === 'delivery' ? 'header-tab--active' : ''}`}
            onClick={() => setMainTab('delivery')}
          >
            Delivery sim
          </button>
          <button
            type="button"
            className={`header-tab ${mainTab === 'batch' ? 'header-tab--active' : ''}`}
            onClick={() => setMainTab('batch')}
          >
            Batch performance
          </button>
        </nav>
      </header>

      {mainTab === 'batch' ? (
        <div className="content content--batch">
          <div className="panel batch-full-panel">
            <h2 className="batch-panel-title">Simulation performance</h2>
            <BatchEvalTab />
          </div>
        </div>
      ) : (
      <div className="content">
        <div className="panel status-panel">
          <h2>Order Status</h2>
          {phase === 'idle' && (
            <fieldset className="sim-fieldset">
              <legend>Routing conditions</legend>
              <p className="parcel-legend-hint">
                Urgency, traffic and demand feed the invoice and ML APIs; trip animation speed follows congestion.
              </p>
              <div className="urgency-row" role="group" aria-label="Delivery urgency">
                {URGENCY_OPTIONS.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`urgency-pill ${urgency === u.id ? 'urgency-pill--active' : ''}`}
                    onClick={() => setUrgency(u.id)}
                  >
                    <span className="urgency-pill-title">{u.shortLabel}</span>
                    <span className="urgency-pill-sub">
                      {u.id === 'normal' && 'Baseline'}
                      {u.id === 'express' && 'Priority queue'}
                      {u.id === 'same_day' && 'Cut-off slot'}
                    </span>
                  </button>
                ))}
              </div>
              <label className="slider-label" htmlFor="traffic-range">
                Traffic congestion ({trafficCongestion}% · {congestionLabel(trafficCongestion)})
              </label>
              <input
                id="traffic-range"
                className="range-input"
                type="range"
                min={0}
                max={100}
                value={trafficCongestion}
                onChange={(e) => setTrafficCongestion(Number(e.target.value))}
              />
              <label className="slider-label" htmlFor="demand-range">
                Zone demand index {demandScore.toFixed(2)}×
              </label>
              <input
                id="demand-range"
                className="range-input"
                type="range"
                min={50}
                max={200}
                step={5}
                value={Math.round(demandScore * 100)}
                onChange={(e) => setDemandScore(Number(e.target.value) / 100)}
              />
              <label className="toggle-line">
                <input
                  type="checkbox"
                  checked={useCustomSimTime}
                  onChange={(e) => setUseCustomSimTime(e.target.checked)}
                />
                <span>Use simulated clock (hour &amp; weekday for ETA / pricing models)</span>
              </label>
              {useCustomSimTime && (
                <div className="sim-clock-grid">
                  <label className="slider-label" htmlFor="sim-hour">
                    Hour (IST)
                  </label>
                  <input
                    id="sim-hour"
                    className="range-input"
                    type="range"
                    min={0}
                    max={23}
                    value={simHour}
                    onChange={(e) => setSimHour(Number(e.target.value))}
                  />
                  <span className="sim-hour-readout">{String(simHour).padStart(2, '0')}:00</span>
                  <label className="slider-label" htmlFor="sim-dow">
                    Weekday
                  </label>
                  <select
                    id="sim-dow"
                    className="place-select sim-dow-select"
                    value={simDow}
                    onChange={(e) => setSimDow(Number(e.target.value))}
                  >
                    {WEEKDAY_LABELS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </fieldset>
          )}
          {phase === 'idle' && (
            <fieldset className="parcel-fieldset">
              <legend>Parcel category</legend>
              <p className="parcel-legend-hint">Tier sets handling fee and distance multiplier for your quote.</p>
              <div className="parcel-grid">
                {PARCEL_CATEGORIES.map((c) => (
                  <label
                    key={c.id}
                    className={`parcel-card ${parcelCategoryId === c.id ? 'parcel-card--selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="parcel-category"
                      value={c.id}
                      checked={parcelCategoryId === c.id}
                      onChange={() => setParcelCategoryId(c.id)}
                    />
                    <span className="parcel-card-title">{c.label}</span>
                    <span className="parcel-card-sub">{c.subtitle}</span>
                    <span className="parcel-card-meta">
                      ×{c.distanceMultiplier.toFixed(2)} dist. · {formatInr(c.handlingInr)} handling
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {phase !== 'idle' && <OrderBill bill={bill} loading={billLoading} />}
          {phase === 'idle' && (
            <div className="location-inputs">
              <p className="location-hint">Locations are in Greater Mumbai only.</p>
              <label htmlFor="pickup-select">Pickup (start)</label>
              <select
                id="pickup-select"
                className="place-select"
                value={pickupPlaceId}
                onChange={(e) => setPickupPlaceId(e.target.value)}
                aria-invalid={samePlace ? 'true' : undefined}
              >
                {MUMBAI_PLACES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label htmlFor="dest-select">Destination (end)</label>
              <select
                id="dest-select"
                className="place-select"
                value={destPlaceId}
                onChange={(e) => setDestPlaceId(e.target.value)}
                aria-invalid={samePlace ? 'true' : undefined}
              >
                {MUMBAI_PLACES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {samePlace && (
                <p className="location-error" role="alert">
                  Pickup and destination must be different.
                </p>
              )}
            </div>
          )}
          <div className={`phase-badge phase-${phase}`}>
            {PHASE_LABELS[phase]}
          </div>
          {routeError && (
            <p className="route-fallback" title="Start the AI engine (port 8000) and OSRM (port 5001) for road routes.">
              {routeError}
            </p>
          )}
          {canAutoAdvance && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="timeline">
            <TimelineStep active={phase !== 'idle'} done={!['idle'].includes(phase)} label="Order Placed" />
            <TimelineStep
              active={['driver_assigned', 'driver_to_pickup'].includes(phase)}
              done={['picked_up', 'driver_to_dest', 'delivered'].includes(phase)}
              label="Driver Assigned"
            />
            <TimelineStep
              active={phase === 'driver_to_pickup'}
              done={['picked_up', 'driver_to_dest', 'delivered'].includes(phase)}
              label="Pickup"
            />
            <TimelineStep
              active={phase === 'driver_to_dest'}
              done={phase === 'delivered'}
              label="Delivered"
            />
          </div>
          <div className="controls">
            {phase === 'idle' ? (
              <button
                className="btn btn-primary"
                onClick={() => void startSimulation()}
                disabled={!canStart}
                title={samePlace ? 'Choose different pickup and destination' : undefined}
              >
                Start Simulation
              </button>
            ) : (
              <>
                {!canAutoAdvance && (
                  <button className="btn btn-primary" onClick={nextStep}>
                    {phase === 'delivered' ? 'Restart' : phase === 'order_placed' ? 'Driver Accepts' : phase === 'driver_assigned' ? 'Driver En Route' : phase === 'picked_up' ? 'Start Delivery' : 'Next'}
                  </button>
                )}
                <button className="btn btn-secondary" onClick={resetSimulation}>
                  Reset
                </button>
              </>
            )}
          </div>
        </div>

        <div className="map-container">
          <div ref={mapRef} className="map" />
          <div className="map-legend">
            <span><span className="dot green" /> Pickup</span>
            <span><span className="dot red" /> Destination</span>
            <span><span className="dot blue" /> Assigned</span>
            <span><span className="dot grey" /> Available</span>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}

function OrderBill({ bill, loading }: { bill: BillDetails | null; loading: boolean }) {
  if (loading || !bill) {
    return (
      <div className="bill-sheet bill-sheet--loading" aria-busy="true">
        <div className="bill-skeleton-line" />
        <div className="bill-skeleton-line short" />
        <div className="bill-skeleton-line" />
        <p className="bill-loading-text">Preparing tax invoice…</p>
      </div>
    )
  }

  const placed = new Date(bill.placedAtIso)
  const dateStr = placed.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  })

  return (
    <div className="bill-sheet">
      <div className="bill-letterhead">
        <div>
          <strong className="bill-brand">SmartDispatch</strong>
          <span className="bill-tagline">Last-mile · Greater Mumbai</span>
        </div>
        <div className="bill-invoice-block">
          <span className="bill-invoice-label">Tax invoice</span>
          <span className="bill-invoice-id">{bill.invoiceId}</span>
        </div>
      </div>
      <p className="bill-address">Mumbai, MH · GSTIN: 27AAAAA0000A1Z5 (simulation)</p>

      <dl className="bill-meta">
        <div>
          <dt>Date</dt>
          <dd>{dateStr}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>
            {bill.pickupName} → {bill.destName}
          </dd>
        </div>
        <div className="bill-meta-span">
          <dt>Parcel</dt>
          <dd>{bill.category.label}</dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>{bill.urgencyLabel}</dd>
        </div>
        <div className="bill-meta-span">
          <dt>Simulated context</dt>
          <dd>
            {bill.congestionLabel} traffic ({bill.trafficCongestion}% index, ×{bill.trafficFactor.toFixed(2)} time) · demand{' '}
            {bill.demandScore}× · {bill.simClockLabel}
          </dd>
        </div>
      </dl>

      {(bill.etaFreeFlowMin != null || bill.etaTrafficAdjustedMin != null) && (
        <div className="bill-eta">
          <span className="bill-eta-title">Travel time · this O/D</span>
          <span className="bill-eta-rows">
            {bill.etaFreeFlowMin != null && (
              <span>
                Typical urban drive (calibrated for Mumbai, from ML/OSRM): ~{bill.etaFreeFlowMin} min
              </span>
            )}
            {bill.etaTrafficAdjustedMin != null && (
              <span>
                With your simulated congestion (×{bill.trafficFactor.toFixed(2)}), +{ETA_FINAL_BUFFER_MIN} min
                handover: ~{bill.etaTrafficAdjustedMin} min
              </span>
            )}
            {bill.mlDurationMin != null && (
              <span className="bill-eta-engine">
                Routing engine only (uncalibrated): ~{bill.mlDurationMin} min
              </span>
            )}
          </span>
        </div>
      )}

      <table className="bill-table">
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col" className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Base fare (platform &amp; coordination)</td>
            <td className="num">{formatInr(bill.baseFareInr)}</td>
          </tr>
          <tr>
            <td>
              Distance tariff — {bill.distanceKm} km ({bill.distanceSource === 'api' ? 'OSRM' : 'est.'}) × {formatInr(PER_KM_INR)}
              /km × {bill.category.distanceMultiplier} tier
            </td>
            <td className="num">{formatInr(bill.distancePortionBaseInr)}</td>
          </tr>
          {bill.trafficPremiumInr > 0.005 && (
            <tr>
              <td>
                Live traffic &amp; congestion adjustment (×{bill.trafficFactor.toFixed(2)} on distance tariff)
              </td>
              <td className="num">{formatInr(bill.trafficPremiumInr)}</td>
            </tr>
          )}
          {bill.handlingInr > 0 && (
            <tr>
              <td>Size &amp; handling surcharge ({bill.category.label})</td>
              <td className="num">{formatInr(bill.handlingInr)}</td>
            </tr>
          )}
          {bill.urgencyFeeInr > 0.005 && (
            <tr>
              <td>Urgency &amp; priority ({bill.urgencyLabel})</td>
              <td className="num">{formatInr(bill.urgencyFeeInr)}</td>
            </tr>
          )}
          {bill.demandSurgeInr > 0.005 && (
            <tr>
              <td>Demand surge (index {bill.demandScore}×)</td>
              <td className="num">{formatInr(bill.demandSurgeInr)}</td>
            </tr>
          )}
          <tr className="bill-subtotal-row">
            <td>Taxable value (before GST)</td>
            <td className="num">{formatInr(bill.subtotalInr)}</td>
          </tr>
          <tr>
            <td>Integrated GST (18%)</td>
            <td className="num">{formatInr(bill.gstInr)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="bill-total-row">
            <th scope="row">Total payable</th>
            <td className="num">{formatInr(bill.totalInr)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="bill-declaration">Declared value for carriage: as per shipper · subject to terms &amp; conditions.</p>

      {bill.mlSuggestedInr != null && (
        <p className="bill-ml-note">
          ML pricing reference (API): {formatInr(bill.mlSuggestedInr)} — invoice total uses the tariff above.
        </p>
      )}
    </div>
  )
}

function TimelineStep({
  active,
  done,
  label,
}: {
  active: boolean
  done: boolean
  label: string
}) {
  return (
    <div className={`timeline-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
      <div className="timeline-dot" />
      <span>{label}</span>
    </div>
  )
}
