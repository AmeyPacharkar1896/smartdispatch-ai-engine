# SmartDispatch Delivery Simulation

A visual simulation of the SmartDispatch order flow: **Place Order → Driver Accepts → Pickup → Delivery**.

## Run

```bash
cd simulation
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Flow

1. **Start Simulation** – Places an order; pickup and destination appear on the Mumbai map
2. **Driver Accepts** – Driver marker appears
3. **Driver En Route** – Driver animates to pickup point
4. **Start Delivery** – Driver animates to destination
5. **Delivered** – Order complete

Uses the same coordinates as the mobile app (Mumbai: Bandra → Andheri area).
