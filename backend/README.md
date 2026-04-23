# Rental Fashion Backend API

NestJS backend API for rental fashion operations system. Handles authentication, lead management, booking, inventory tracking with QR codes, payment processing, and rental workflows.

## Swagger-First Rental Operations Flow

Swagger UI is available at `http://localhost:3001/docs` after `npm run start:dev`.

The documented business flow is:

```text
Lead -> Booking -> Payment -> Pickup -> Return -> Settlement
```

Core operation endpoints:

```text
POST /api/leads
POST /api/leads/{id}/contact
POST /api/leads/{id}/request-deposit

POST /api/bookings
POST /api/bookings/{id}/confirm
POST /api/bookings/{id}/deposit

POST /api/payments/bookings/{bookingId}/initialize
PATCH /api/payments/{id}/process

GET  /api/scan/{qrCode}
POST /api/pickup/{bookingId}/scan
POST /api/pickup/{bookingId}/confirm

POST /api/return/{bookingId}/inspect
POST /api/return/{bookingId}/settle
```

Implemented structure:

```text
src/
  auth/        JWT login, refresh, role-aware Swagger examples
  users/       admin/staff/cashier user management
  leads/       lead capture, contact, deposit request, conversion
  bookings/    booking creation, pricing, availability, deposit locking
  payments/    payment records, gateway checkout, refunds, receipts
  inventory/   QR-coded physical items, statuses, calendar blocks
  pickup/      booking QR scan validation and pickup confirmation
  returns/     return inspection, fee suggestion, settlement
  scan/        generic QR lookup with current booking and schedule
  pricing/     RentalPricingService shared by booking and settlement flows
  prisma/      Prisma module and database client
prisma/
  schema.prisma
```

Example payloads are embedded in Swagger through DTO decorators. Representative requests:

```json
POST /api/bookings
{
  "customerId": "clu7cus0000008l4z2bqkhk9",
  "leadId": "clu7lead0000008l4c1jlav50",
  "pickupDate": "2026-05-01T10:00:00.000Z",
  "returnDate": "2026-05-04T18:00:00.000Z",
  "durationDays": 3,
  "items": [
    {
      "productId": "clu7prd0000008l43a9d6qk2",
      "variantId": "clu7var0000008l4czg5as9f",
      "quantity": 1
    }
  ],
  "accessories": ["veil", "garment bag"]
}
```

```json
POST /api/bookings/{id}/deposit
{
  "amount": 425000,
  "paymentMethod": "CASH"
}
```

```json
POST /api/return/{bookingId}/settle
{
  "qrCodes": ["QR-DRS-RED-M-0001"],
  "condition": "damaged",
  "actualReturnDate": "2026-05-04T19:30:00.000Z",
  "damageFee": 150000,
  "accessoryLostValues": [50000],
  "affectsNextBooking": false
}
```

Business rules implemented:

- `RentalPricingService` calculates base price, duration discount, early pickup fee, late fee, deposits, and settlement totals.
- Inventory is locked only after completed booking deposit, and deposit locking re-checks overlap conflicts.
- Booking creation supports exact item selection or variant-based availability selection.
- Pickup confirmation requires all expected QR codes and marks items `RENTED`.
- Return settlement validates QR codes, calculates late/damage/refund, creates fee/refund payment records, and releases or damages inventory.

## 🏗️ Architecture

**Framework**: NestJS + TypeScript  
**Database**: PostgreSQL with Prisma ORM  
**Authentication**: JWT  
**Authorization**: RBAC (5 roles)  

## 📦 Core Modules

### Auth Module
- JWT authentication with refresh tokens
- Login/logout/refresh endpoints
- User validation & session management

### Users Module
- Staff management (create, read, update, delete)
- Role assignment
- RBAC enforcement

### Leads Module (CRM)
- Lead creation from website forms
- Lead status tracking (NEW → CONTACTED → QUOTED → WON/REJECTED)
- Lead assignment to sales staff
- Lead to booking conversion

### Bookings Module
- Booking calendar & date management
- Availability checking
- Blocking dates for maintenance
- Rental day calculation

### Inventory Module
- Item-level inventory tracking
- QR code generation & scanning
- Item status management (AVAILABLE, RENTED, DAMAGED, RETIRED)
- Product links

### Rentals Module
- Pickup workflow (QR scan)
- Return workflow (QR scan)
- Damage tracking
- Rental status management

### Payments Module
- Payment creation & processing
- Multiple payment methods (CASH, CARD, STRIPE, MOMO)
- Refund handling
- PDF receipt generation
- Daily revenue reporting

### Reports Module
- Daily revenue reports
- Inventory status
- Rental analytics
- Lead conversion metrics
- Staff performance

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Setup

```bash
cd backend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your database URL and secrets

# Initialize database
npm run prisma:migrate

# Optionally seed data
npm run prisma:seed

# Start development server
npm run start:dev
```

Server runs on `http://localhost:3001`

## 🔐 RBAC Roles

1. **super_admin** - Full system access
2. **manager** - Lead/booking/staff management, reports
3. **sales** - Lead management, booking creation
4. **operator** - QR scanning, pickup/return
5. **cashier** - Payment processing, receipts

## 🔌 API Endpoints

### Authentication
```
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
```

### Users (Admin only)
```
GET    /api/users
GET    /api/users/:id
POST   /api/users
PATCH  /api/users/:id
DELETE /api/users/:id
```

### Leads
```
GET    /api/leads
GET    /api/leads/:id
POST   /api/leads
PATCH  /api/leads/:id
PATCH  /api/leads/:id/assign
POST   /api/leads/:id/convert-to-booking
```

### Bookings
```
GET    /api/bookings
GET    /api/bookings/:id
GET    /api/bookings/calendar/:date
GET    /api/bookings/availability?startDate=&endDate=
POST   /api/bookings
```

### Inventory
```
GET    /api/inventory/items
GET    /api/inventory/items/:id
GET    /api/inventory/qr/:code (QR scan)
GET    /api/inventory/items/:id/status
POST   /api/inventory/items
PATCH  /api/inventory/items/:id/status
POST   /api/inventory/calendar-block
```

### Rentals
```
GET    /api/rentals
GET    /api/rentals/active
GET    /api/rentals/:id
POST   /api/rentals (from booking)
POST   /api/rentals/:id/pickup (QR scan)
POST   /api/rentals/:id/return (QR scan)
PATCH  /api/rentals/:id/confirm-payment
PATCH  /api/rentals/:id/complete
```

### Payments
```
GET    /api/payments
GET    /api/payments/:id
POST   /api/payments
PATCH  /api/payments/:id/process
PATCH  /api/payments/:id/refund
POST   /api/payments/:id/receipt
GET    /api/payments/:id/receipt
```

### Reports (Manager+)
```
GET    /api/reports/revenue?date=2026-04-16
GET    /api/reports/inventory-status
GET    /api/reports/rental-analytics?startDate=&endDate=
GET    /api/reports/lead-conversion?startDate=&endDate=
GET    /api/reports/staff-performance
```

## 🗄️ Database Schema

**Key Models:**
- `User` (staff with roles)
- `Customer` (from leads)
- `Lead` (CRM)
- `Product` (rental items)
- `InventoryItem` (QR code tracked)
- `Booking` (rental booking)
- `Rental` (rental instance)
- `Payment` (payment record)
- `Receipt` (PDF receipts)

## 📋 Rental Workflow

```
1. Client creates Lead (via client website)
   ↓
2. Sales Staff contacts & quotes
   ↓
3. Lead converts to Booking
   ↓
4. Admin creates Rental from Booking
   ↓
5. Payment processing (Cashier)
   ↓
6. Operator scans QR → Pickup
   ↓
7. Customer wears items (IN_RENTAL)
   ↓
8. Operator scans QR → Return
   ↓
9. Check condition, update damage cost
   ↓
10. Process payment/refund (Cashier)
    ↓
11. Complete Rental
```

## 🛠️ Development

### Run tests
```bash
npm run test
npm run test:watch
npm run test:cov
```

### Lint
```bash
npm run lint
```

### Database
```bash
npm run prisma:generate   # Generate Prisma client
npm run prisma:migrate    # Run migrations
npm run prisma:studio     # Open Prisma Studio GUI
npm run prisma:seed       # Run seed script
```

## 🚢 Deployment (Render)

### Environment Variables Required
```
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
STRIPE_SECRET_KEY=sk_...
SMTP_USER=email@gmail.com
SMTP_PASSWORD=app-password
CLIENT_URL=https://client.example.com
ADMIN_URL=https://admin.example.com
```

### Deploy Steps
1. Push code to GitHub
2. Connect repo to Render
3. Set environment variables
4. Deploy (auto-runs `npm run prisma:migrate`)

## 📜 License
MIT
