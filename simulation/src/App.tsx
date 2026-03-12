import { useState, useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Default Mumbai bounds for random drivers
const MUMBAI_BOUNDS = { latMin: 19.0, latMax: 19.25, lngMin: 72.78, lngMax: 73.0 }
const NUM_DRIVERS = 6
const FIXED_DELIVERY_ITEM = '1× Document envelope'

type LatLng = { lat: number; lng: number }

function randomInRange(min: number, max: number, seed: number): number {
  const x = Math.sin(seed) * 10000
  return min + (x - Math.floor(x)) * (max - min)
}

function generateDrivers(): LatLng[] {
  const out: LatLng[] = []
  for (let i = 0; i < NUM_DRIVERS; i++) {
    out.push({
      lat: randomInRange(MUMBAI_BOUNDS.latMin, MUMBAI_BOUNDS.latMax, i * 7 + 1),
      lng: randomInRange(MUMBAI_BOUNDS.lngMin, MUMBAI_BOUNDS.lngMax, i * 11 + 2),
    })
  }
  return out
}

function distKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dlat = (Math.PI / 180) * (b.lat - a.lat)
  const dlng = (Math.PI / 180) * (b.lng - a.lng)
  const x = Math.sin(dlat / 2) ** 2 + Math.cos((Math.PI / 180) * a.lat) * Math.cos((Math.PI / 180) * b.lat) * Math.sin(dlng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
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

const DEFAULT_PICKUP: LatLng = { lat: 19.076, lng: 72.8777 }
const DEFAULT_DEST: LatLng = { lat: 19.2183, lng: 72.9781 }

export default function App() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<{ pickup?: L.Marker; dest?: L.Marker; driver?: L.Marker; idleDrivers: L.Marker[] }>({ idleDrivers: [] })
  const polylineRef = useRef<L.Polyline | null>(null)
  const routePathRef = useRef<LatLng[] | null>(null)

  const drivers = useMemo(() => generateDrivers(), [])

  const [pickupLocation, setPickupLocation] = useState<LatLng>(DEFAULT_PICKUP)
  const [destLocation, setDestLocation] = useState<LatLng>(DEFAULT_DEST)
  const [phase, setPhase] = useState<SimPhase>('idle')
  const [assignedDriverIndex, setAssignedDriverIndex] = useState<number | null>(null)
  const [driverPos, setDriverPos] = useState<LatLng>(DEFAULT_PICKUP)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [routePath, setRoutePath] = useState<LatLng[] | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)

  // Initialize map
  useEffect(() => {
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
  }, [])

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
      const m = L.marker([pickupLocation.lat, pickupLocation.lng], {
        icon: createIcon('#10b981', '📦'),
      })
        .addTo(map)
        .bindPopup('Pickup')
      markersRef.current.pickup = m
    }

    // Destination marker (red)
    if (['order_placed', 'driver_assigned', 'driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const m = L.marker([destLocation.lat, destLocation.lng], {
        icon: createIcon('#ef4444', '🏁'),
      })
        .addTo(map)
        .bindPopup('Destination')
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
  }, [phase, pickupLocation, destLocation, drivers, assignedDriverIndex, driverPos])

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
    const durationMs = 5000
    const steps = 60
    const stepMs = durationMs / steps
    let step = 0
    const path = routePathRef.current

    if (phase === 'driver_to_pickup') {
      const to = pickupLocation
      const from = driverPos
      const id = setInterval(() => {
        step++
        const t = Math.min(step / steps, 1)
        setProgress(Math.round(t * 100))
        const pos = path?.length ? interpolateAlongPath(path, t) : interpolate(from, to, t)
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
        const pos = path?.length ? interpolateAlongPath(path, t) : interpolate(from, to, t)
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

  const startSimulation = () => {
    setPhase('order_placed')
    setAssignedDriverIndex(null)
    setDriverPos(pickupLocation)
    setProgress(0)
    setRouteError(null)
    setRoutePath(null)
    routePathRef.current = null
  }

  const nextStep = async () => {
    if (phase === 'idle') {
      startSimulation()
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
  }

  const canAutoAdvance = phase === 'driver_to_pickup' || phase === 'driver_to_dest'

  return (
    <div className="app">
      <header className="header">
        <h1>SmartDispatch</h1>
        <span className="subtitle">Delivery Simulation</span>
      </header>

      <div className="content">
        <div className="panel status-panel">
          <h2>Order Status</h2>
          <div className="delivery-item">{FIXED_DELIVERY_ITEM}</div>
          {phase === 'idle' && (
            <div className="location-inputs">
              <label>Pickup (start)</label>
              <div className="input-row">
                <input
                  type="number"
                  step="any"
                  placeholder="Lat"
                  value={pickupLocation.lat}
                  onChange={(e) => setPickupLocation((p) => ({ ...p, lat: parseFloat(e.target.value) || p.lat }))}
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Lng"
                  value={pickupLocation.lng}
                  onChange={(e) => setPickupLocation((p) => ({ ...p, lng: parseFloat(e.target.value) || p.lng }))}
                />
              </div>
              <label>Destination (end)</label>
              <div className="input-row">
                <input
                  type="number"
                  step="any"
                  placeholder="Lat"
                  value={destLocation.lat}
                  onChange={(e) => setDestLocation((p) => ({ ...p, lat: parseFloat(e.target.value) || p.lat }))}
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Lng"
                  value={destLocation.lng}
                  onChange={(e) => setDestLocation((p) => ({ ...p, lng: parseFloat(e.target.value) || p.lng }))}
                />
              </div>
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
              <button className="btn btn-primary" onClick={startSimulation}>
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
