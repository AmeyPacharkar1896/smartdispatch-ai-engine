import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import './App.css'

// Mumbai coordinates (from SmartDispatch create flow)
const PICKUP = { lat: 19.076, lng: 72.8777, label: 'Pickup (123 Main St, Mumbai)' }
const DESTINATION = { lat: 19.2183, lng: 72.9781, label: 'Destination (456 Park Ave, Mumbai)' }
// Driver starts south-west of pickup
const DRIVER_START = { lat: 19.048, lng: 72.832, label: 'Driver' }

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

function interpolate(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  t: number
): { lat: number; lng: number } {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  }
}

export default function App() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<{ pickup?: L.Marker; dest?: L.Marker; driver?: L.Marker }>({})
  const polylineRef = useRef<L.Polyline | null>(null)

  const [phase, setPhase] = useState<SimPhase>('idle')
  const [driverPos, setDriverPos] = useState(DRIVER_START)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)

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

    const { pickup, dest, driver } = markersRef.current

    // Cleanup old markers
    pickup?.remove()
    dest?.remove()
    driver?.remove()
    polylineRef.current?.remove()

    if (phase === 'idle') return

    // Pickup marker (green) - show when order placed
    if (['order_placed', 'driver_assigned', 'driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const m = L.marker([PICKUP.lat, PICKUP.lng], {
        icon: createIcon('#10b981', '📦'),
      })
        .addTo(map)
        .bindPopup(PICKUP.label)
      markersRef.current.pickup = m
    }

    // Destination marker (red)
    if (['order_placed', 'driver_assigned', 'driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const m = L.marker([DESTINATION.lat, DESTINATION.lng], {
        icon: createIcon('#ef4444', '🏁'),
      })
        .addTo(map)
        .bindPopup(DESTINATION.label)
      markersRef.current.dest = m
    }

    // Driver marker (blue) - show when driver assigned
    if (['driver_assigned', 'driver_to_pickup', 'picked_up', 'driver_to_dest', 'delivered'].includes(phase)) {
      const m = L.marker([driverPos.lat, driverPos.lng], {
        icon: createIcon('#3b82f6', '🚗'),
      })
        .addTo(map)
        .bindPopup('Delivery agent')
      markersRef.current.driver = m
    }
  }, [phase])

  // Update driver marker position during animation (avoid full re-creation)
  useEffect(() => {
    const driver = markersRef.current.driver
    if (driver) {
      driver.setLatLng([driverPos.lat, driverPos.lng])
    }
  }, [driverPos])

  // Animate driver movement
  useEffect(() => {
    if (!isRunning) return
    const durationMs = 4000 // 4 seconds per leg
    const steps = 60
    const stepMs = durationMs / steps
    let step = 0
    let startPhase = phase

    if (phase === 'driver_to_pickup') {
      const from = DRIVER_START
      const to = PICKUP
      const id = setInterval(() => {
        step++
        const t = Math.min(step / steps, 1)
        setProgress(Math.round(t * 100))
        setDriverPos({ ...interpolate(from, to, t), label: 'Driver' })
        if (t >= 1) {
          clearInterval(id)
          setPhase('picked_up')
          setDriverPos(PICKUP)
          setProgress(100)
          setIsRunning(false)
        }
      }, stepMs)
      return () => clearInterval(id)
    }

    if (phase === 'driver_to_dest') {
      const from = PICKUP
      const to = DESTINATION
      const id = setInterval(() => {
        step++
        const t = Math.min(step / steps, 1)
        setProgress(Math.round(t * 100))
        setDriverPos({ ...interpolate(from, to, t), label: 'Driver' })
        if (t >= 1) {
          clearInterval(id)
          setPhase('delivered')
          setDriverPos(DESTINATION)
          setProgress(100)
          setIsRunning(false)
        }
      }, stepMs)
      return () => clearInterval(id)
    }
  }, [phase, isRunning])

  const startSimulation = () => {
    setPhase('order_placed')
    setDriverPos(DRIVER_START)
    setProgress(0)
  }

  const nextStep = () => {
    if (phase === 'idle') {
      startSimulation()
    } else if (phase === 'order_placed') {
      setPhase('driver_assigned')
      setDriverPos(DRIVER_START)
    } else if (phase === 'driver_assigned') {
      setPhase('driver_to_pickup')
      setIsRunning(true)
    } else if (phase === 'picked_up') {
      setPhase('driver_to_dest')
      setIsRunning(true)
    } else if (phase === 'delivered') {
      setPhase('idle')
    }
  }

  const resetSimulation = () => {
    setPhase('idle')
    setDriverPos(DRIVER_START)
    setProgress(0)
    setIsRunning(false)
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
          <div className={`phase-badge phase-${phase}`}>
            {PHASE_LABELS[phase]}
          </div>
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
            <span><span className="dot blue" /> Driver</span>
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
