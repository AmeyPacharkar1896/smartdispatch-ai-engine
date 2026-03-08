# SmartDispatch Simulation Documentation

This document provides a comprehensive overview of the SmartDispatch simulation module located in the `simulation` folder. It covers requirements, features, technical details, execution instructions, and future improvements.

## 1. Overview and Purpose

The SmartDispatch delivery simulation is a visual frontend tool designed to simulate and visualize the lifecycle of an order's delivery process. It demonstrates the flow from order placement to final delivery on an interactive map.

Currently, it provides a realistic UI representation of the delivery state machine: **Place Order → Driver Accepts → Pickup → Delivery**, using predefined coordinates in the Mumbai region.

## 2. Technical Stack & Requirements

The project is a single-page application built with modern web technologies:
- **Framework:** React 18, TypeScript
- **Build Tool:** Vite
- **Mapping Library:** Leaflet (`leaflet`, `@types/leaflet`)
- **Map Tiles:** CARTO Dark Matter (via OpenStreetMap attribution)

### Prerequisites to Run
- **Node.js**: v16+ recommended
- **npm** or **yarn** package manager

## 3. How It Works (The Flow)

The application maintains a state machine (`SimPhase`) representing the delivery timeline.

### Phases
1. **`idle`**: The map is loaded. Ready to start the simulation.
2. **`order_placed`**: The user clicks "Start Simulation". Pickup (📦) and Destination (🏁) markers appear on the map.
3. **`driver_assigned`**: The driver is assigned to the order. A Driver marker (🚗) appears at their starting location.
4. **`driver_to_pickup`**: The driver marker animates from their starting location to the pickup point over a set duration. A progress bar tracks this movement.
5. **`picked_up`**: The driver has reached the pickup location and the package is marked as picked up.
6. **`driver_to_dest`**: The driver marker animates from the pickup location to the final destination. A progress bar tracks this movement.
7. **`delivered`**: The driver reaches the destination. The order is successfully completed.

### Key Components
- **Map Engine:** The Leaflet map initializes centered roughly around Mumbai (Bandra/Andheri area).
- **Interpolation Animation:** The driver's movement is currently animated via a linear interpolation function (`interpolate` in `App.tsx`), moving step-by-step between coordinates across 60 frames over 4 seconds.
- **Controls & Timeline:** A sidebar panel controls the simulation state ("Next", "Start Delivery", "Restart") and visually updates a timeline component corresponding to the active `SimPhase`.

## 4. Running the Simulation

To install dependencies and start the local development server:

```bash
cd smartdispatch-ai-engine/simulation
npm install
npm run dev
```

Then, open your browser and navigate to the local URL provided by Vite (typically `http://localhost:5173`).

## 5. Current Hardcoded Data

For simulation purposes, the coordinates are statically defined:
- **Pickup:** `Lat: 19.076, Lng: 72.8777` (123 Main St, Mumbai)
- **Destination:** `Lat: 19.2183, Lng: 72.9781` (456 Park Ave, Mumbai)
- **Driver Start Point:** `Lat: 19.048, Lng: 72.832`

## 6. What Needs To Be Done (Future Enhancements)

To transition this module from a static visual simulation to a live, production-ready tracking dashboard, the following steps are required:

1. **Backend Integration (WebSocket / Polling):**
   - Remove the localized `setInterval` animation.
   - Connect to a WebSocket or SSE (Server-Sent Events) endpoint to receive real-time driver coordinates from the SmartDispatch backend.

2. **Dynamic Order Data:**
   - Fetch actual pickup and destination coordinates from the backend via an API using an Order ID, rather than using hardcoded Mumbai coordinates.
   - Update the UI to reflect real addresses, order IDs, and driver details instead of generic labels.

3. **Road-Snapping / Directions API:**
   - The current map uses straight-line interpolation between points.
   - Integrate a routing API (like OSRM, Google Maps Directions API, or Mapbox Directions) to draw the actual road polyline and animate the driver along valid road networks.

4. **Multi-Order Support:**
   - Refactor the React state to manage an array of active orders and drivers simultaneously, allowing dispatchers to monitor the entire fleet on a single map.

5. **Error Handling & Edge Cases:**
   - Implement handlers for edge cases such as driver connection drops, order cancellations, or manual re-routing.
