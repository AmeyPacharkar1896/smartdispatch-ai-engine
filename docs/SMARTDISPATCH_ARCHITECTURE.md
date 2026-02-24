# SmartDispatch React Native – Architecture

## Overview

SmartDispatch is an on-demand delivery app with three user personas: **Customer**, **Driver**, and **Admin**. The React Native app consumes the SmartDispatch Backend API and the AI Engine API.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        SmartDispatch Mobile App (React Native)                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                       │
│   │   Customer   │    │    Driver    │    │    Admin     │                       │
│   │     Flow     │    │    Flow      │    │    Flow      │                       │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                       │
│          │                   │                   │                               │
│          └───────────────────┼───────────────────┘                               │
│                              │                                                    │
│                    ┌─────────▼─────────┐                                          │
│                    │  React Navigation │                                          │
│                    │  (Auth + Tab/Stack)│                                         │
│                    └─────────┬─────────┘                                          │
│                              │                                                    │
│                    ┌─────────▼─────────┐     ┌──────────────────┐                 │
│                    │  State (Zustand)  │     │  Secure Storage   │                 │
│                    │  • auth           │     │  • access_token   │                 │
│                    │  • user           │     │  • refresh_token  │                 │
│                    │  • orders         │     │                   │                 │
│                    └─────────┬─────────┘     └──────────────────┘                 │
│                              │                                                    │
│                    ┌─────────▼─────────┐                                          │
│                    │     API Layer     │                                          │
│                    │  • authService    │                                          │
│                    │  • orderService   │                                          │
│                    │  • driverService   │                                          │
│                    │  • aiService      │                                          │
│                    └─────────┬─────────┘                                          │
│                              │                                                    │
└──────────────────────────────┼──────────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────────┐    ┌───────────────────┐
│ Backend API   │    │ AI Engine API     │    │ (Future: Push)     │
│ localhost:8001│    │ localhost:8000    │    │                    │
│ /api/v1/*     │    │ /route, /predict  │    │                    │
└───────────────┘    └───────────────────┘    └───────────────────┘
```

---

## Tech Stack

| Layer        | Technology                 | Purpose                        |
|-------------|----------------------------|--------------------------------|
| Framework   | React Native (Expo SDK 52) | Cross-platform mobile app      |
| Language    | TypeScript                 | Type safety                    |
| Routing     | Expo Router                | File-based navigation          |
| State       | Zustand                    | Auth, user, orders state       |
| HTTP        | Axios                      | API client with interceptors   |
| Storage     | expo-secure-store          | Token persistence              |
| Maps        | react-native-maps          | Pickup/drop locations          |
| UI          | NativeWind (Tailwind)      | Styling (optional) / StyleSheet|

---

## Project Structure

```
mobile/
├── app/                          # Expo Router (file-based)
│   ├── _layout.tsx               # Root layout, auth gate
│   ├── index.tsx                 # Splash / redirect
│   ├── (auth)/                   # Auth group (no token)
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (customer)/               # Customer flow
│   │   ├── _layout.tsx           # Tab layout
│   │   ├── index.tsx             # Home / Create order
│   │   ├── orders.tsx            # My orders
│   │   └── profile.tsx
│   ├── (driver)/                 # Driver flow
│   │   ├── _layout.tsx           # Tab layout
│   │   ├── index.tsx             # Available orders
│   │   ├── my-orders.tsx         # Accepted orders
│   │   └── profile.tsx
│   └── (admin)/                 # Admin flow (optional)
│       └── ...
├── src/
│   ├── api/
│   │   ├── client.ts            # Axios instance + interceptors
│   │   ├── auth.api.ts
│   │   ├── orders.api.ts
│   │   ├── drivers.api.ts
│   │   └── ai.api.ts
│   ├── stores/
│   │   ├── auth.store.ts
│   │   └── order.store.ts
│   ├── components/
│   │   ├── ui/                   # Button, Input, Card
│   │   ├── OrderCard.tsx
│   │   ├── MapPicker.tsx
│   │   └── AddressInput.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   └── useOrders.ts
│   ├── types/
│   │   └── api.types.ts
│   └── config/
│       └── env.ts
├── assets/
├── app.json
├── package.json
└── tsconfig.json
```

---

## Screen Flows

### Customer
1. **Login / Signup** → Role selection (or default customer)
2. **Home** → Create delivery (pickup, destination, package, vehicle type)
3. **Order created** → Pay (mock/simulated)
4. **Orders** → List, details, rate driver, cancel

### Driver
1. **Login** → Role = driver
2. **Profile** → Create/update driver profile (license)
3. **Available** → See unassigned orders, accept
4. **My orders** → Update status (picked_up, delivered)

### Admin
1. **Login** → Role = admin
2. **Orders** → List, filter, assign driver
3. **Users** → Paginated list

---

## API Integration

- **Base URL**: `http://localhost:8001/api/v1` (Backend)
- **AI Base URL**: `http://localhost:8000` (AI Engine)
- **Auth**: JWT Bearer in `Authorization` header
- **Refresh**: Use `refreshToken` when 401; retry original request

---

## Security

- Store `access_token` and `refresh_token` in `expo-secure-store`
- Never log tokens
- Use HTTPS in production; for local dev use `http` with appropriate setup (e.g. iOS ATS exception, Android cleartext)

---

## Future Considerations

- Push notifications for order status
- Real-time driver location (WebSockets)
- Offline support for order history
- Deep linking for order URLs
