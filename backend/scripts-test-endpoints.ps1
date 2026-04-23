$ErrorActionPreference = 'Stop'

$baseUrl = 'http://localhost:3001/api'
$results = New-Object System.Collections.Generic.List[Object]

function Add-Result {
  param(
    [string]$Method,
    [string]$Path,
    [int]$Status,
    [string]$Outcome,
    [string]$Note
  )
  $results.Add([pscustomobject]@{
    method = $Method
    path = $Path
    status = $Status
    outcome = $Outcome
    note = $Note
  }) | Out-Null
}

function Invoke-Test {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [string]$Token = $null,
    [int[]]$AcceptStatus = @(200,201)
  )

  $uri = "$baseUrl$Path"
  $headers = @{}
  if ($Token) {
    $headers['Authorization'] = "Bearer $Token"
  }

  try {
    $params = @{
      Uri = $uri
      Method = $Method
      Headers = $headers
      TimeoutSec = 25
    }

    if ($null -ne $Body) {
      $params['ContentType'] = 'application/json'
      $params['Body'] = ($Body | ConvertTo-Json -Depth 10)
    }

    $resp = Invoke-WebRequest @params
    $status = [int]$resp.StatusCode
    $ok = $AcceptStatus -contains $status
    Add-Result $Method $Path $status ($(if ($ok) { 'PASS' } else { 'FAIL' })) ($(if ($ok) { 'OK' } else { "Unexpected status $status" }))

    $parsed = $null
    if ($resp.Content) {
      try { $parsed = $resp.Content | ConvertFrom-Json } catch { $parsed = $resp.Content }
    }

    return [pscustomobject]@{ Status = $status; Body = $parsed }
  }
  catch {
    $status = 0
    $note = $_.Exception.Message
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errBody = $reader.ReadToEnd()
        if ($errBody) { $note = $errBody }
      } catch {}
    }

    $ok = $AcceptStatus -contains $status
    Add-Result $Method $Path $status ($(if ($ok) { 'PASS' } else { 'FAIL' })) ($(if ($ok) { "Expected error status $status" } else { $note }))
    return [pscustomobject]@{ Status = $status; Body = $null }
  }
}

# start backend process
$serverProc = Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-Command','npm run start' -WorkingDirectory (Get-Location).Path -PassThru

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $h = Invoke-WebRequest -Uri "$baseUrl/health" -Method GET -TimeoutSec 5
    if ([int]$h.StatusCode -eq 200) { $healthy = $true; break }
  } catch {}
}

if (-not $healthy) {
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  throw 'Backend did not become healthy on /api/health'
}

try {
  # Public
  Invoke-Test -Method 'GET' -Path '/health' | Out-Null

  # Auth
  $adminLogin = Invoke-Test -Method 'POST' -Path '/auth/login' -Body @{ email='admin@test.com'; password='password123' }
  $managerLogin = Invoke-Test -Method 'POST' -Path '/auth/login' -Body @{ email='manager@test.com'; password='password123' }
  $salesLogin = Invoke-Test -Method 'POST' -Path '/auth/login' -Body @{ email='sales@test.com'; password='password123' }
  $operatorLogin = Invoke-Test -Method 'POST' -Path '/auth/login' -Body @{ email='operator@test.com'; password='password123' }
  $cashierLogin = Invoke-Test -Method 'POST' -Path '/auth/login' -Body @{ email='cashier@test.com'; password='password123' }

  $adminToken = $adminLogin.Body.accessToken
  $managerToken = $managerLogin.Body.accessToken
  $salesToken = $salesLogin.Body.accessToken
  $operatorToken = $operatorLogin.Body.accessToken
  $cashierToken = $cashierLogin.Body.accessToken

  Invoke-Test -Method 'POST' -Path '/auth/refresh' -Body @{ refreshToken = $adminLogin.Body.refreshToken } | Out-Null
  Invoke-Test -Method 'POST' -Path '/auth/logout' -Body @{} | Out-Null

  # Users
  $usersResp = Invoke-Test -Method 'GET' -Path '/users' -Token $adminToken
  $salesUser = $usersResp.Body | Where-Object { $_.email -eq 'sales@test.com' } | Select-Object -First 1
  $managerUser = $usersResp.Body | Where-Object { $_.email -eq 'manager@test.com' } | Select-Object -First 1
  Invoke-Test -Method 'GET' -Path "/users/$($salesUser.id)" -Token $adminToken | Out-Null

  $tmpEmail = "tmp-user-$(Get-Random)@test.com"
  $createdUser = Invoke-Test -Method 'POST' -Path '/users' -Token $adminToken -Body @{
    email = $tmpEmail
    password = 'password123'
    fullName = 'Temporary User'
    phone = '0900999999'
    role = 'SALES'
  }
  Invoke-Test -Method 'PATCH' -Path "/users/$($createdUser.Body.id)" -Token $adminToken -Body @{ fullName = 'Temporary User Updated' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/users/$($createdUser.Body.id)/archive" -Token $adminToken | Out-Null
  $createdUser2 = Invoke-Test -Method 'POST' -Path '/users' -Token $adminToken -Body @{
    email = "tmp-user-del-$(Get-Random)@test.com"
    password = 'password123'
    fullName = 'Temporary Delete User'
    role = 'SALES'
  }
  Invoke-Test -Method 'DELETE' -Path "/users/$($createdUser2.Body.id)" -Token $adminToken -AcceptStatus @(200) | Out-Null

  # Leads
  Invoke-Test -Method 'GET' -Path '/leads' -Token $adminToken | Out-Null
  $newLead = Invoke-Test -Method 'POST' -Path '/leads' -Body @{
    email = "lead-$(Get-Random)@test.com"
    name = 'Lead Temp'
    phone = '0911222333'
    source = 'web'
    notes = 'temp lead'
  }
  Invoke-Test -Method 'GET' -Path "/leads/$($newLead.Body.id)" -Token $adminToken | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/leads/$($newLead.Body.id)" -Token $salesToken -Body @{ notes = 'updated lead note' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/leads/$($newLead.Body.id)/status" -Token $salesToken -Body @{ status = 'CONTACTED' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/leads/$($newLead.Body.id)/assign" -Token $managerToken -Body @{ userId = $salesUser.id } | Out-Null

  # need booking id for convert endpoint
  $bookingsList = Invoke-Test -Method 'GET' -Path '/bookings' -Token $adminToken
  $anyBooking = $bookingsList.Body | Select-Object -First 1
  Invoke-Test -Method 'POST' -Path "/leads/$($newLead.Body.id)/convert-to-booking" -Token $salesToken -Body @{ bookingId = $anyBooking.id } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/leads/$($newLead.Body.id)/archive" -Token $managerToken | Out-Null

  # Products
  $products = Invoke-Test -Method 'GET' -Path '/products'
  $product = $products.Body | Select-Object -First 1
  Invoke-Test -Method 'GET' -Path "/products/$($product.id)" | Out-Null

  $variant = Invoke-Test -Method 'POST' -Path "/products/$($product.id)/variants" -Token $adminToken -Body @{
    name = 'Temp Variant'
    sku = "TEMP-SKU-$(Get-Random)"
    size = 'M'
    color = 'black'
    material = 'cotton'
    imageUrls = @('https://example.com/1.jpg')
  }
  Invoke-Test -Method 'PATCH' -Path "/products/variants/$($variant.Body.id)" -Token $adminToken -Body @{ name = 'Temp Variant Updated' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/products/variants/$($variant.Body.id)/archive" -Token $adminToken | Out-Null

  # Inventory
  $items = Invoke-Test -Method 'GET' -Path '/inventory/items' -Token $adminToken
  $item = $items.Body | Select-Object -First 1
  Invoke-Test -Method 'GET' -Path "/inventory/items/$($item.id)" -Token $adminToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/inventory/qr/RF-VEST-BLACK-001' -Token $operatorToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/inventory/qr/RF-VEST-BLACK-001/resolve' -Token $operatorToken | Out-Null
  Invoke-Test -Method 'GET' -Path "/inventory/items/$($item.id)/status" -Token $adminToken | Out-Null
  Invoke-Test -Method 'GET' -Path "/inventory/items/$($item.id)/qr-image" -Token $adminToken | Out-Null
  Invoke-Test -Method 'GET' -Path "/inventory/items/$($item.id)/schedule" -Token $adminToken | Out-Null

  $newItem = Invoke-Test -Method 'POST' -Path '/inventory/items' -Token $adminToken -Body @{
    productId = $product.id
    condition = 'excellent'
  }
  Invoke-Test -Method 'PATCH' -Path "/inventory/items/$($newItem.Body.id)/status" -Token $operatorToken -Body @{ status = 'AVAILABLE' } | Out-Null
  $regen = Invoke-Test -Method 'PATCH' -Path "/inventory/items/$($newItem.Body.id)/regenerate-qr" -Token $operatorToken
  Invoke-Test -Method 'GET' -Path "/inventory/qr/$($regen.Body.qrCode)/resolve" -Token $operatorToken | Out-Null
  Invoke-Test -Method 'POST' -Path '/inventory/calendar-block' -Token $managerToken -Body @{
    inventoryItemId = $newItem.Body.id
    startDate = '2026-06-01T00:00:00.000Z'
    endDate = '2026-06-03T00:00:00.000Z'
    reason = 'temp maintenance'
  } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/inventory/items/$($newItem.Body.id)/archive" -Token $managerToken | Out-Null

  # Bookings
  Invoke-Test -Method 'GET' -Path '/bookings?status=CONFIRMED' -Token $adminToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/bookings/calendar/2026-04-19' -Token $adminToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/bookings/availability?startDate=2026-05-01&endDate=2026-05-02' -Token $adminToken | Out-Null
  Invoke-Test -Method 'GET' -Path "/bookings/$($anyBooking.id)" -Token $adminToken | Out-Null

  $availableItem = ($items.Body | Where-Object { $_.status -eq 'AVAILABLE' } | Select-Object -First 1)
  $createBooking = Invoke-Test -Method 'POST' -Path '/bookings' -Token $salesToken -Body @{
    customerId = 'seed-customer-001'
    startDate = '2026-06-10T00:00:00.000Z'
    endDate = '2026-06-12T00:00:00.000Z'
    createdById = $salesUser.id
    items = @(@{ inventoryItemId = $availableItem.id; pricePerDay = 200000 })
  }
  Invoke-Test -Method 'PATCH' -Path "/bookings/$($createBooking.Body.id)/status" -Token $salesToken -Body @{ status='CONFIRMED' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/bookings/$($createBooking.Body.id)/archive" -Token $managerToken | Out-Null

  # Rentals
  Invoke-Test -Method 'GET' -Path '/rentals' -Token $adminToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/rentals/active' -Token $adminToken | Out-Null

  $rental = Invoke-Test -Method 'POST' -Path '/rentals' -Token $salesToken -Body @{ bookingId = 'seed-booking-pending' }
  Invoke-Test -Method 'GET' -Path "/rentals/$($rental.Body.id)" -Token $adminToken | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/rentals/$($rental.Body.id)/confirm-payment" -Token $cashierToken | Out-Null
  Invoke-Test -Method 'POST' -Path "/rentals/$($rental.Body.id)/pickup" -Token $operatorToken -Body @{ qrCodes=@('RF-AODAI-RED-001'); conditionNotes='ok'} | Out-Null
  Invoke-Test -Method 'POST' -Path '/rentals/seed-rental-in-rental/return' -Token $operatorToken -Body @{ qrCodes=@('RF-GOWN-GOLD-001'); conditionNotes='returned'; damageAmount=0 } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/rentals/$($rental.Body.id)/complete" -Token $managerToken | Out-Null

  # Payments
  Invoke-Test -Method 'GET' -Path '/payments' -Token $cashierToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/payments/seed-payment-confirmed' -Token $cashierToken | Out-Null

  $payment = Invoke-Test -Method 'POST' -Path '/payments' -Token $cashierToken -Body @{
    rentalId = $rental.Body.id
    amount = 500000
    rentalAmount = 400000
    depositAmount = 100000
    paymentMethod = 'CASH'
    description = 'temp payment'
    processedById = $managerUser.id
  }
  Invoke-Test -Method 'PATCH' -Path "/payments/$($payment.Body.id)/process" -Token $cashierToken -Body @{ externalTransactionId='TXN-TEMP-001' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/payments/$($payment.Body.id)/refund" -Token $cashierToken -Body @{ refundAmount = 10000 } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/payments/$($payment.Body.id)/status" -Token $cashierToken -Body @{ status='COMPLETED' } | Out-Null
  $receiptFromPayment = Invoke-Test -Method 'POST' -Path "/payments/$($payment.Body.id)/receipt" -Token $cashierToken
  Invoke-Test -Method 'GET' -Path "/payments/$($payment.Body.id)/receipt" -Token $cashierToken | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/payments/$($payment.Body.id)/archive" -Token $managerToken | Out-Null

  # Receipts
  Invoke-Test -Method 'GET' -Path '/receipts' -Token $cashierToken | Out-Null
  Invoke-Test -Method 'GET' -Path "/receipts/$($receiptFromPayment.Body.id)" -Token $cashierToken | Out-Null
  Invoke-Test -Method 'GET' -Path "/receipts/$($receiptFromPayment.Body.id)/pdf" -Token $cashierToken | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/receipts/$($receiptFromPayment.Body.id)" -Token $cashierToken -Body @{ type='RENTAL_RECEIPT' } | Out-Null
  Invoke-Test -Method 'POST' -Path "/receipts/$($receiptFromPayment.Body.id)/print" -Token $cashierToken | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/receipts/$($receiptFromPayment.Body.id)/archive" -Token $managerToken | Out-Null

  # Appointments
  Invoke-Test -Method 'GET' -Path '/appointments' -Token $salesToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/appointments/seed-appointment-consultation' -Token $salesToken | Out-Null
  $appointment = Invoke-Test -Method 'POST' -Path '/appointments' -Token $salesToken -Body @{
    customerId = 'seed-customer-001'
    type = 'CONSULTATION'
    scheduledAt = '2026-06-15T09:00:00.000Z'
    staffId = $salesUser.id
    room = 'Room A'
    notes = 'temp appointment'
  }
  Invoke-Test -Method 'PATCH' -Path "/appointments/$($appointment.Body.id)" -Token $salesToken -Body @{ notes='updated appointment note' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/appointments/$($appointment.Body.id)/status" -Token $operatorToken -Body @{ status='CHECKED_IN' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/appointments/$($appointment.Body.id)/archive" -Token $managerToken | Out-Null

  # Preview requests
  Invoke-Test -Method 'GET' -Path '/preview-requests' -Token $salesToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/preview-requests/seed-preview-completed' -Token $salesToken | Out-Null
  $preview = Invoke-Test -Method 'POST' -Path '/preview-requests' -Token $salesToken -Body @{
    customerId = 'seed-customer-001'
    garmentName = 'Temp Garment'
    notes = 'temp preview'
    assignedToId = $salesUser.id
  }
  Invoke-Test -Method 'PATCH' -Path "/preview-requests/$($preview.Body.id)" -Token $salesToken -Body @{ notes='updated preview' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/preview-requests/$($preview.Body.id)/status" -Token $salesToken -Body @{ status='PROCESSING' } | Out-Null
  Invoke-Test -Method 'PATCH' -Path "/preview-requests/$($preview.Body.id)/archive" -Token $managerToken | Out-Null

  # Reports
  Invoke-Test -Method 'GET' -Path '/reports/revenue?date=2026-04-18' -Token $managerToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/reports/inventory-status' -Token $managerToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/reports/rental-analytics?startDate=2026-04-01&endDate=2026-04-30' -Token $managerToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/reports/lead-conversion?startDate=2026-04-01&endDate=2026-04-30' -Token $managerToken | Out-Null
  Invoke-Test -Method 'GET' -Path '/reports/staff-performance' -Token $managerToken | Out-Null
}
finally {
  if ($serverProc -and !$serverProc.HasExited) {
    Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  }
}

$summary = [pscustomobject]@{
  total = $results.Count
  pass = ($results | Where-Object { $_.outcome -eq 'PASS' }).Count
  fail = ($results | Where-Object { $_.outcome -eq 'FAIL' }).Count
}

$payload = [pscustomobject]@{
  summary = $summary
  results = $results
}

$payload | ConvertTo-Json -Depth 10 | Set-Content -Path 'endpoint-test-results.json'
Write-Output ($payload | ConvertTo-Json -Depth 4)
