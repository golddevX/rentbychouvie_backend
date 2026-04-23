import {
  AppointmentStatus,
  AppointmentType,
  AuditAction,
  BookingStatus,
  DisputeCategory,
  DisputePriority,
  DisputeResolutionOutcome,
  DisputeStatus,
  InventoryItemStatus,
  LeadStatus,
  PaymentGateway,
  PaymentMethod,
  PaymentStatus,
  PaymentTransactionStatus,
  PaymentType,
  PreviewRequestStatus,
  PrismaClient,
  ReceiptType,
  RentalOrderPaymentStatus,
  RentalOrderStatus,
  RentalStatus,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'password123';
const now = new Date('2026-04-23T09:00:00.000Z');

const day = (offset: number, hour = 9, minute = 0) => {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + offset);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
};

const money = (value: number) => value;

const users = [
  { id: 'seed-user-super-admin', email: 'quan.nguyen@lumiere.vn', fullName: 'Nguyễn Minh Quân', phone: '0901000001', role: UserRole.SUPER_ADMIN, isActive: true },
  { id: 'seed-user-manager', email: 'ngocanh.tran@lumiere.vn', fullName: 'Trần Ngọc Anh', phone: '0901000002', role: UserRole.MANAGER, isActive: true },
  { id: 'seed-user-sales-1', email: 'thaovy.le@lumiere.vn', fullName: 'Lê Thảo Vy', phone: '0901000003', role: UserRole.SALES, isActive: true },
  { id: 'seed-user-sales-2', email: 'giahan.pham@lumiere.vn', fullName: 'Phạm Gia Hân', phone: '0901000004', role: UserRole.SALES, isActive: true },
  { id: 'seed-user-operator-1', email: 'quocbao.vo@lumiere.vn', fullName: 'Võ Quốc Bảo', phone: '0901000005', role: UserRole.OPERATOR, isActive: true },
  { id: 'seed-user-operator-2', email: 'thanhtam.huynh@lumiere.vn', fullName: 'Huỳnh Thanh Tâm', phone: '0901000006', role: UserRole.OPERATOR, isActive: true },
  { id: 'seed-user-cashier', email: 'khanhlinh.dang@lumiere.vn', fullName: 'Đặng Khánh Linh', phone: '0901000007', role: UserRole.CASHIER, isActive: true },
  { id: 'seed-user-cashier-backup', email: 'ducnam.bui@lumiere.vn', fullName: 'Bùi Đức Nam', phone: '0901000008', role: UserRole.CASHIER, isActive: false },
];

const customers = [
  ['seed-customer-001', 'Nguyễn Hà My', '0912000001', 'ha.my@example.com', 'website', 'Cần váy dự tiệc cưới, ưu tiên tone đỏ đô.'],
  ['seed-customer-002', 'Trần Minh Châu', '0912000002', 'minh.chau@example.com', 'Zalo', 'Đã gửi số đo 3 vòng, muốn thử váy sau giờ làm.'],
  ['seed-customer-003', 'Lê Phương Linh', '0912000003', 'phuong.linh@example.com', 'Facebook', 'Cần đầm đi gala công ty, thích dáng kín đáo.'],
  ['seed-customer-004', 'Phạm Gia Bảo', '0912000004', 'gia.bao@example.com', 'khách đến trực tiếp', 'Thuê vest cho lễ ăn hỏi, cần lấy trong ngày.'],
  ['seed-customer-005', 'Võ Thanh Mai', '0912000005', 'thanh.mai@example.com', 'giới thiệu', 'Bạn cũ giới thiệu, cần áo dài chụp ảnh gia đình.'],
  ['seed-customer-006', 'Huỳnh Ngọc Trâm', '0912000006', 'ngoc.tram@example.com', 'website', 'Muốn váy cưới đơn giản để chụp pre-wedding.'],
  ['seed-customer-007', 'Đặng Hoàng Nam', '0912000007', 'hoang.nam@example.com', 'Zalo', 'Hỏi thuê blazer nữ cho bạn gái, đã gửi hình mẫu.'],
  ['seed-customer-008', 'Bùi Yến Nhi', '0912000008', 'yen.nhi@example.com', 'Facebook', 'Cần váy hồng pastel cho tiệc sinh nhật.'],
  ['seed-customer-009', 'Đỗ Khánh Vy', '0912000009', 'khanh.vy@example.com', 'website', 'Muốn giữ lịch online trước khi ghé thử.'],
  ['seed-customer-010', 'Ngô Tuấn Kiệt', '0912000010', 'tuan.kiet@example.com', 'khách đến trực tiếp', 'Cần vest đen size L, lấy cuối tuần.'],
  ['seed-customer-011', 'Mai Anh Thư', '0912000011', 'anh.thu@example.com', 'Zalo', 'Thích váy đính đá ánh bạc, cần tư vấn phụ kiện.'],
  ['seed-customer-012', 'Cao Thùy Dương', '0912000012', 'thuy.duong@example.com', 'Facebook', 'Cần áo dài cách tân cho lễ tốt nghiệp.'],
  ['seed-customer-013', 'Tạ Minh Huyền', '0912000013', 'minh.huyen@example.com', 'giới thiệu', 'Khách ở quận 7, hỏi giao nhận tận nơi.'],
  ['seed-customer-014', 'Phan Quốc Hưng', '0912000014', 'quoc.hung@example.com', 'website', 'Thuê vest cho chụp kỷ yếu nhóm.'],
  ['seed-customer-015', 'Lâm Bảo Ngọc', '0912000015', 'bao.ngoc@example.com', 'Zalo', 'Muốn váy xanh cổ vuông, cần che bắp tay.'],
  ['seed-customer-016', 'Nguyễn Tường Vy', '0912000016', 'tuong.vy@example.com', 'Facebook', 'Cần set blazer màu kem cho sự kiện ra mắt.'],
  ['seed-customer-017', 'Trịnh Hoài An', '0912000017', 'hoai.an@example.com', 'khách đến trực tiếp', 'Đã thử váy đỏ, đang cân nhắc cọc.'],
  ['seed-customer-018', 'Vũ Nhật Linh', '0912000018', 'nhat.linh@example.com', 'website', 'Cần váy cưới đuôi cá ren trắng.'],
  ['seed-customer-019', 'Hồ Khánh Ngân', '0912000019', 'khanh.ngan@example.com', 'giới thiệu', 'Khách cần váy cho tiệc tối ở khách sạn.'],
  ['seed-customer-020', 'Đinh Gia Tuệ', '0912000020', 'gia.tue@example.com', 'Zalo', 'Muốn xem preview AI trước khi đặt lịch thử.'],
  ['seed-customer-021', 'Lý Thanh Hà', '0912000021', 'thanh.ha@example.com', 'Facebook', 'Cần đầm đen cổ yếm, hỏi cọc giữ lịch.'],
  ['seed-customer-022', 'Châu Minh Anh', '0912000022', 'minh.anh@example.com', 'website', 'Thuê áo dài mẹ và con, cần 2 bộ cùng tone.'],
  ['seed-customer-023', 'Triệu Bích Ngọc', '0912000023', 'bich.ngoc@example.com', 'khách đến trực tiếp', 'Cần váy đi tiệc cưới ngoài trời.'],
  ['seed-customer-024', 'Hà Đức Phúc', '0912000024', 'duc.phuc@example.com', 'Zalo', 'Cần vest kem cho lễ đính hôn.'],
  ['seed-customer-025', 'Tô Ngọc Diệp', '0912000025', 'ngoc.diep@example.com', 'Facebook', 'Hỏi chính sách bồi thường nếu váy dính makeup.'],
  ['seed-customer-026', 'Nguyễn Quỳnh Chi', '0912000026', 'quynh.chi@example.com', 'website', 'Cần váy satin be, lấy sớm hơn lịch.'],
  ['seed-customer-027', 'Trần Phúc An', '0912000027', 'phuc.an@example.com', 'giới thiệu', 'Cần thuê phụ kiện chụp ảnh cưới.'],
  ['seed-customer-028', 'Lê Nhật Minh', '0912000028', 'nhat.minh@example.com', 'Zalo', 'Cần vest xanh navy, hỏi phí giao hàng.'],
  ['seed-customer-029', 'Phạm Hồng Nhung', '0912000029', 'hong.nhung@example.com', 'khách đến trực tiếp', 'Đã đặt lịch fitting, thích váy dáng chữ A.'],
  ['seed-customer-030', 'Bùi Khánh Hòa', '0912000030', 'khanh.hoa@example.com', 'website', 'Muốn thuê váy cho tiệc tốt nghiệp cuối tháng.'],
] as const;

const productDefs = [
  ['P001', 'Váy dạ hội đỏ xẻ tà', 'Váy đỏ đô form ôm, xẻ tà cao, phù hợp tiệc cưới và gala buổi tối.', 'Váy dạ hội', 850000, 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1200&q=85'],
  ['P002', 'Váy cưới đuôi cá ren trắng', 'Váy cưới ren trắng đuôi cá, tôn dáng, phù hợp chụp pre-wedding.', 'Váy cưới', 1800000, 'https://images.unsplash.com/photo-1594552072238-b8a33785b261?auto=format&fit=crop&w=1200&q=85'],
  ['P003', 'Đầm satin xanh cổ vuông', 'Đầm satin xanh cổ vuông, chất vải rủ nhẹ, sang trọng nhưng dễ mặc.', 'Đầm dự tiệc', 720000, 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1200&q=85'],
  ['P004', 'Váy dự tiệc đính đá ánh bạc', 'Váy ánh bạc đính đá nhẹ, bắt sáng đẹp khi chụp hình sự kiện.', 'Đầm dự tiệc', 950000, 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=85'],
  ['P005', 'Áo dài cách tân hoa nhí', 'Áo dài cách tân họa tiết hoa nhí, nhẹ nhàng cho lễ tốt nghiệp và chụp ảnh.', 'Áo dài', 520000, 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=85'],
  ['P006', 'Set blazer nữ cao cấp màu kem', 'Set blazer kem phom đứng, phù hợp sự kiện công sở và tiệc ra mắt.', 'Blazer nữ', 690000, 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1200&q=85'],
  ['P007', 'Đầm nhung đen cổ yếm', 'Đầm nhung đen cổ yếm, tối giản, hợp tiệc tối và chụp lookbook.', 'Đầm dự tiệc', 780000, 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=85'],
  ['P008', 'Váy công chúa hồng pastel', 'Váy hồng pastel nhiều lớp voan, hợp sinh nhật và concept ngọt ngào.', 'Váy dạ hội', 880000, 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1200&q=85'],
  ['P009', 'Áo dài đỏ truyền thống', 'Áo dài đỏ truyền thống, chất lụa mềm, phù hợp lễ gia tiên.', 'Áo dài', 560000, 'https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?auto=format&fit=crop&w=1200&q=85'],
  ['P010', 'Vest nam đen slim-fit', 'Vest đen slim-fit lịch sự, có đủ áo khoác, quần và nơ cổ.', 'Vest nam', 650000, 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=85'],
  ['P011', 'Vest nam xanh navy', 'Vest xanh navy hiện đại, phù hợp chụp kỷ yếu và lễ đính hôn.', 'Vest nam', 620000, 'https://images.unsplash.com/photo-1516826957135-700dedea698c?auto=format&fit=crop&w=1200&q=85'],
  ['P012', 'Váy chữ A be thanh lịch', 'Váy chữ A màu be, kín đáo, dễ phối phụ kiện cho tiệc ban ngày.', 'Đầm dự tiệc', 640000, 'https://images.unsplash.com/photo-1512316609839-ce289d3eba0a?auto=format&fit=crop&w=1200&q=85'],
  ['P013', 'Đầm lệch vai tím khói', 'Đầm lệch vai tím khói, có chi tiết drape nhẹ ở eo.', 'Váy dạ hội', 790000, 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=85'],
  ['P014', 'Váy cưới minimalist satin', 'Váy cưới satin tối giản, cổ thuyền, hợp cô dâu thích phong cách tinh gọn.', 'Váy cưới', 1600000, 'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=85'],
  ['P015', 'Áo dài trắng thêu ngọc trai', 'Áo dài trắng thêu ngọc trai nhỏ, trang nhã cho lễ tốt nghiệp.', 'Áo dài', 600000, 'https://images.unsplash.com/photo-1524503033411-c9566986fc8f?auto=format&fit=crop&w=1200&q=85'],
  ['P016', 'Jumpsuit trắng dự tiệc', 'Jumpsuit trắng ống rộng, hiện đại, phù hợp sự kiện cocktail.', 'Jumpsuit', 580000, 'https://images.unsplash.com/photo-1539008835657-9e8e9680c956?auto=format&fit=crop&w=1200&q=85'],
  ['P017', 'Đầm lụa champagne cổ đổ', 'Đầm lụa màu champagne cổ đổ, ánh vải sang và mềm mại.', 'Đầm dự tiệc', 760000, 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=1200&q=85'],
  ['P018', 'Váy sequin xanh rêu', 'Váy sequin xanh rêu, nổi bật khi lên sân khấu hoặc tiệc tối.', 'Váy dạ hội', 920000, 'https://images.unsplash.com/photo-1542060748-10c28b62716f?auto=format&fit=crop&w=1200&q=85'],
  ['P019', 'Set phụ kiện tiệc tối bạc', 'Bộ phụ kiện gồm clutch bạc, khuyên tai và dây chuyền đồng bộ.', 'Phụ kiện', 280000, 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1200&q=85'],
  ['P020', 'Khăn voan cưới dài', 'Khăn voan cưới dài mềm, viền ren nhẹ, phù hợp chụp ảnh cưới.', 'Phụ kiện cưới', 350000, 'https://images.unsplash.com/photo-1525258946800-98cfd641d0de?auto=format&fit=crop&w=1200&q=85'],
] as const;

const colors = ['đỏ đô', 'trắng ngà', 'đen', 'xanh navy', 'hồng pastel', 'be', 'bạc', 'tím khói'];
const sizes = ['S', 'M', 'L', 'XL'];

type ProductSeed = {
  id: string;
  variantIds: string[];
  itemIds: string[];
  price: number;
};

type BookingSeed = {
  id: string;
  customerId: string;
  itemId: string;
  productId: string;
  variantId: string;
  status: BookingStatus;
  rentalStatus?: RentalStatus;
  pickupOffset: number;
  returnOffset: number;
  note: string;
  createdById: string;
  bookingDepositPaid?: number;
  bookingDepositRequired?: number;
  securityDepositHeld?: number;
  securityDepositRequired?: number;
  priceAdjustment?: number;
  itemStatus?: InventoryItemStatus;
};

const roleLabelVi: Record<UserRole, string> = {
  SUPER_ADMIN: 'Quản trị hệ thống',
  MANAGER: 'Quản lý cửa hàng',
  SALES: 'Nhân viên tư vấn',
  OPERATOR: 'Nhân viên vận hành',
  CASHIER: 'Thu ngân',
};

function includesValue<T extends string>(values: readonly T[], value: string | undefined) {
  return !!value && (values as readonly string[]).includes(value);
}

async function resetDatabase() {
  await prisma.$transaction([
    prisma.disputeEvidence.deleteMany(),
    prisma.dispute.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.previewRequest.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.receipt.deleteMany(),
    prisma.paymentTransaction.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.returnInspection.deleteMany(),
    prisma.rental.deleteMany(),
    prisma.bookingItem.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.rentalOrderItem.deleteMany(),
    prisma.rentalOrder.deleteMany(),
    prisma.calendarBlock.deleteMany(),
    prisma.dailyReport.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.inventoryItem.deleteMany(),
    prisma.productVariant.deleteMany(),
    prisma.product.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.siteSetting.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function createUsers() {
  const password = await bcrypt.hash(PASSWORD, 10);
  await prisma.user.createMany({
    data: users.map((user) => ({
      ...user,
      password,
      avatar: `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(user.fullName)}`,
    })),
  });
}

async function createCustomers() {
  await prisma.customer.createMany({
    data: customers.map(([id, name, phone, email]) => ({
      id,
      name,
      phone,
      email,
    })),
  });
}

async function createProductsAndInventory(): Promise<ProductSeed[]> {
  const result: ProductSeed[] = [];

  for (const [code, name, description, category, price, image] of productDefs) {
    const productId = `seed-product-${code.toLowerCase()}`;
    await prisma.product.create({
      data: {
        id: productId,
        name,
        description: `${description} Ghi chú thuê: cửa hàng sẽ kiểm tra form, phụ kiện và tình trạng trước khi bàn giao.`,
        category,
        price,
        image,
        isActive: true,
      },
    });

    const variantIds: string[] = [];
    const itemIds: string[] = [];
    const productColors = [colors[productDefs.findIndex((item) => item[0] === code) % colors.length], colors[(productDefs.findIndex((item) => item[0] === code) + 3) % colors.length]];

    for (let variantIndex = 0; variantIndex < 2; variantIndex += 1) {
      const size = sizes[(variantIndex + productDefs.findIndex((item) => item[0] === code)) % sizes.length];
      const color = productColors[variantIndex];
      const variantId = `seed-variant-${code.toLowerCase()}-${variantIndex + 1}`;
      variantIds.push(variantId);

      await prisma.productVariant.create({
        data: {
          id: variantId,
          productId,
          name: `${name} - size ${size}, màu ${color}`,
          sku: `LUM-${code}-${size}-${variantIndex + 1}`,
          size,
          color,
          material: category.includes('Vest') ? 'vải tuyết mưa cao cấp' : category.includes('Áo dài') ? 'lụa mềm có lót' : 'lụa/satin phối lót cao cấp',
          imageUrls: JSON.stringify([image, `${image}&sat=-15`]),
          isActive: true,
        },
      });

      for (let itemIndex = 0; itemIndex < 2; itemIndex += 1) {
        const sequence = variantIndex * 2 + itemIndex + 1;
        const itemId = `seed-item-${code.toLowerCase()}-${sequence}`;
        itemIds.push(itemId);
        await prisma.inventoryItem.create({
          data: {
            id: itemId,
            productId,
            variantId,
            qrCode: `QR-${code}-${String(sequence).padStart(3, '0')}`,
            serialNumber: `ITEM-${code}-${String(sequence).padStart(3, '0')}`,
            status: InventoryItemStatus.AVAILABLE,
            condition: sequence % 4 === 0 ? 'Khóa lưng hơi lỏng, cần kiểm tra trước khi giao.' : sequence % 5 === 0 ? 'Thiếu belt đi kèm, đã chuyển bảo trì nếu phát sinh booking.' : 'Form đẹp, mới giặt hấp và sẵn sàng cho thuê.',
            imageUrls: JSON.stringify([image, `${image}&crop=entropy`]),
          },
        });
      }
    }

    await prisma.product.update({
      where: { id: productId },
      data: { totalItems: itemIds.length },
    });

    result.push({ id: productId, variantIds, itemIds, price });
  }

  return result;
}

function staff(role: UserRole, index = 0) {
  return users.filter((user) => user.role === role)[index]?.id ?? users[0].id;
}

async function createLeads(productSeeds: ProductSeed[]) {
  const statuses = [
    LeadStatus.NEW,
    LeadStatus.CONTACTED,
    LeadStatus.DEPOSIT_REQUESTED,
    LeadStatus.DEPOSIT_RECEIVED,
    LeadStatus.QUOTED,
    LeadStatus.BOOKING_CREATED,
    LeadStatus.REJECTED,
    LeadStatus.LOST,
  ];

  const notes = [
    'Khách cần váy dự tiệc cưới, muốn tone đỏ đô.',
    'Khách không ghé shop được, đã gửi số đo 3 vòng qua Zalo.',
    'Đã tư vấn mẫu tương tự, đang chờ khách cọc giữ lịch.',
    'Khách muốn thử 2 mẫu trong cùng buổi fitting.',
    'Khách hỏi chính sách giao nhận và phí cọc bảo đảm.',
    'Khách cần lấy váy sau 20h, đã ghi chú cho vận hành.',
    'Khách muốn xem preview AI trước khi quyết định.',
    'Khách đổi ngày sự kiện nên tạm hủy nhu cầu.',
  ];

  const data = customers.slice(0, 25).map(([customerId, , , , source], index) => {
    const product = productSeeds[index % productSeeds.length];
    const status = statuses[index % statuses.length];
    return {
      id: `seed-lead-${String(index + 1).padStart(2, '0')}`,
      customerId,
      status,
      source,
      notes: `${notes[index % notes.length]} Sản phẩm quan tâm: ${productDefs[index % productDefs.length][1]}.`,
      quotedPrice: product.price,
      requiredItems: index % 4 === 0 ? 2 : 1,
      rentalDates: JSON.stringify({
        productName: productDefs[index % productDefs.length][1],
        pickupDate: day(index - 3, 11).toISOString(),
        returnDate: day(index, 18).toISOString(),
        customerNote: notes[index % notes.length],
      }),
      contactDeadlineAt: day(index % 5 === 0 ? -1 : 1, 10 + (index % 7)),
      contactedAt: includesValue([LeadStatus.CONTACTED, LeadStatus.DEPOSIT_REQUESTED, LeadStatus.DEPOSIT_RECEIVED, LeadStatus.BOOKING_CREATED, LeadStatus.LOST, LeadStatus.REJECTED], status) ? day(-2, 10) : null,
      depositRequestedAt: includesValue([LeadStatus.DEPOSIT_REQUESTED, LeadStatus.DEPOSIT_RECEIVED, LeadStatus.BOOKING_CREATED], status) ? day(-1, 14) : null,
      depositDeadlineAt: includesValue([LeadStatus.DEPOSIT_REQUESTED, LeadStatus.DEPOSIT_RECEIVED], status) ? day(0, 19) : null,
      depositReceivedAt: includesValue([LeadStatus.DEPOSIT_RECEIVED, LeadStatus.BOOKING_CREATED], status) ? day(0, 8) : null,
      lostReason: status === LeadStatus.LOST || status === LeadStatus.REJECTED ? 'Khách đổi lịch sự kiện hoặc chọn mẫu ngoài ngân sách.' : null,
      assignedToId: index % 5 === 0 ? staff(UserRole.MANAGER) : staff(UserRole.SALES, index % 2),
    };
  });

  await prisma.lead.createMany({ data });
}

async function createBookings(productSeeds: ProductSeed[]): Promise<BookingSeed[]> {
  const bookingStatuses = [
    BookingStatus.DRAFT,
    BookingStatus.DEPOSIT_REQUESTED,
    BookingStatus.DEPOSIT_RECEIVED,
    BookingStatus.CONFIRMED,
    BookingStatus.SCHEDULED_PICKUP,
    BookingStatus.PICKED_UP,
    BookingStatus.RETURN_PENDING,
    BookingStatus.RETURNED,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.CONFIRMED,
    BookingStatus.RETURN_PENDING,
    BookingStatus.COMPLETED,
    BookingStatus.DEPOSIT_REQUESTED,
    BookingStatus.PICKED_UP,
    BookingStatus.RETURNED,
    BookingStatus.SCHEDULED_PICKUP,
    BookingStatus.DEPOSIT_RECEIVED,
    BookingStatus.CANCELLED,
    BookingStatus.COMPLETED,
  ];

  const notes = [
    'Khách giữ lịch online và sẽ ghé thử trước khi lấy.',
    'Khách hẹn lấy váy sau 20h.',
    'Khách cần lấy sớm hơn 1 ngày, đã phụ thu.',
    'Đã xác nhận đủ phụ kiện đi kèm trước khi bàn giao.',
    'Khách cần chỉnh nhẹ phần eo, vận hành đã ghi chú.',
    'Khách đã nhận váy và ký xác nhận tình trạng.',
    'Đang chờ khách trả váy trong hôm nay.',
    'Khách trả váy, cần kiểm tra vết makeup phần ngực.',
    'Đơn đã hoàn tất, hoàn cọc đầy đủ.',
    'Khách hủy vì sự kiện đổi lịch.',
  ];

  const bookings: BookingSeed[] = [];
  const availableItems = productSeeds.flatMap((product) => product.itemIds.map((itemId, itemIndex) => ({
    productId: product.id,
    variantId: product.variantIds[Math.floor(itemIndex / 2)],
    itemId,
    price: product.price,
  })));

  for (let index = 0; index < bookingStatuses.length; index += 1) {
    const item = availableItems[index];
    const status = bookingStatuses[index];
    const pickupOffset = index < 10 ? index - 7 : index - 2;
    const returnOffset = pickupOffset + 3 + (index % 3);
    const rentalDays = Math.max(1, returnOffset - pickupOffset);
    const basePrice = item.price;
    const totalPrice = basePrice * rentalDays + (index % 4 === 0 ? 120000 : 0);
    const hasDeposit = !includesValue([BookingStatus.DRAFT, BookingStatus.DEPOSIT_REQUESTED, BookingStatus.CANCELLED], status);
    const booking: BookingSeed = {
      id: `seed-booking-${String(index + 1).padStart(2, '0')}`,
      customerId: customers[index % customers.length][0],
      itemId: item.itemId,
      productId: item.productId,
      variantId: item.variantId,
      status,
      pickupOffset,
      returnOffset,
      note: notes[index % notes.length],
      createdById: index % 4 === 0 ? staff(UserRole.MANAGER) : staff(UserRole.SALES, index % 2),
      bookingDepositRequired: Math.round(totalPrice * 0.5),
      bookingDepositPaid: hasDeposit ? Math.round(totalPrice * 0.5) : 0,
      securityDepositRequired: 500000,
      securityDepositHeld: includesValue([BookingStatus.PICKED_UP, BookingStatus.RETURN_PENDING], status) ? 500000 : includesValue([BookingStatus.RETURNED, BookingStatus.COMPLETED], status) ? 0 : 0,
      priceAdjustment: index % 4 === 0 ? 120000 : 0,
    };

    if (includesValue([BookingStatus.DEPOSIT_REQUESTED, BookingStatus.DEPOSIT_RECEIVED], status)) booking.rentalStatus = RentalStatus.PENDING_PAYMENT;
    if (includesValue([BookingStatus.CONFIRMED, BookingStatus.SCHEDULED_PICKUP], status)) booking.rentalStatus = RentalStatus.CONFIRMED;
    if (status === BookingStatus.PICKED_UP) booking.rentalStatus = RentalStatus.PICKED_UP;
    if (status === BookingStatus.RETURN_PENDING) booking.rentalStatus = RentalStatus.IN_RENTAL;
    if (status === BookingStatus.RETURNED) booking.rentalStatus = RentalStatus.RETURNED;
    if (status === BookingStatus.COMPLETED) booking.rentalStatus = RentalStatus.COMPLETED;
    if (status === BookingStatus.CANCELLED) booking.rentalStatus = RentalStatus.CANCELLED;

    if (includesValue([BookingStatus.CONFIRMED, BookingStatus.SCHEDULED_PICKUP, BookingStatus.DEPOSIT_RECEIVED], status)) booking.itemStatus = InventoryItemStatus.RESERVED;
    if (includesValue([BookingStatus.PICKED_UP, BookingStatus.RETURN_PENDING], status)) booking.itemStatus = InventoryItemStatus.RENTED;
    if (status === BookingStatus.RETURNED && index % 2 === 1) booking.itemStatus = InventoryItemStatus.MAINTENANCE;
    if (status === BookingStatus.RETURNED && index % 2 === 0) booking.itemStatus = InventoryItemStatus.DAMAGED;

    const startDate = day(booking.pickupOffset, 10 + (index % 8));
    const endDate = day(booking.returnOffset, 18);

    await prisma.booking.create({
      data: {
        id: booking.id,
        customerId: booking.customerId,
        leadId: index < 15 ? `seed-lead-${String(index + 1).padStart(2, '0')}` : undefined,
        status,
        startDate,
        endDate,
        pickupDate: startDate,
        returnDate: endDate,
        rentalDays,
        durationDays: rentalDays,
        basePrice,
        priceAdjustment: booking.priceAdjustment ?? 0,
        totalPrice,
        bookingDepositRequired: booking.bookingDepositRequired ?? 0,
        bookingDepositPaid: booking.bookingDepositPaid ?? 0,
        securityDepositRequired: booking.securityDepositRequired ?? 0,
        securityDepositHeld: booking.securityDepositHeld ?? 0,
        securityDepositOption: 'Cọc bảo đảm hoàn lại sau khi kiểm tra trang phục.',
        accessories: JSON.stringify(index % 3 === 0 ? ['clutch bạc', 'khuyên tai', 'belt đi kèm'] : ['móc treo', 'túi bảo quản']),
        lockedAt: hasDeposit ? day(-1, 15) : undefined,
        failureReason: status === BookingStatus.CANCELLED ? 'Khách đổi lịch sự kiện, không còn nhu cầu thuê.' : undefined,
        notes: booking.note,
        createdById: booking.createdById,
        items: {
          create: {
            id: `seed-booking-item-${String(index + 1).padStart(2, '0')}`,
            productId: booking.productId,
            variantId: booking.variantId,
            inventoryItemId: booking.itemId,
            quantity: 1,
            pricePerDay: basePrice,
          },
        },
      },
    });

    if (booking.rentalStatus) {
      await prisma.rental.create({
        data: {
          id: `seed-rental-${String(index + 1).padStart(2, '0')}`,
          bookingId: booking.id,
          status: booking.rentalStatus,
          scheduledPickupDate: startDate,
          actualPickupDate: includesValue([RentalStatus.PICKED_UP, RentalStatus.IN_RENTAL, RentalStatus.RETURNED, RentalStatus.COMPLETED], booking.rentalStatus) ? startDate : undefined,
          pickedUpById: includesValue([RentalStatus.PICKED_UP, RentalStatus.IN_RENTAL, RentalStatus.RETURNED, RentalStatus.COMPLETED], booking.rentalStatus) ? staff(UserRole.OPERATOR, index % 2) : undefined,
          scheduledReturnDate: endDate,
          actualReturnDate: includesValue([RentalStatus.RETURNED, RentalStatus.COMPLETED], booking.rentalStatus) ? endDate : undefined,
          returnedById: includesValue([RentalStatus.RETURNED, RentalStatus.COMPLETED], booking.rentalStatus) ? staff(UserRole.OPERATOR, (index + 1) % 2) : undefined,
          pickupConditionNotes: includesValue([RentalStatus.PICKED_UP, RentalStatus.IN_RENTAL, RentalStatus.RETURNED, RentalStatus.COMPLETED], booking.rentalStatus) ? 'Đã kiểm tra khóa kéo, đường may và phụ kiện trước khi giao.' : undefined,
          returnConditionNotes: includesValue([RentalStatus.RETURNED, RentalStatus.COMPLETED], booking.rentalStatus) ? 'Đã nhận lại trang phục và chụp ảnh tình trạng sau thuê.' : undefined,
          damageCost: status === BookingStatus.RETURNED && index % 2 === 0 ? 300000 : 0,
          inventoryItems: { connect: [{ id: booking.itemId }] },
        },
      });
    }

    if (booking.itemStatus) {
      await prisma.inventoryItem.update({
        where: { id: booking.itemId },
        data: { status: booking.itemStatus },
      });
    }

    bookings.push(booking);
  }

  await prisma.lead.updateMany({
    where: { id: { in: ['seed-lead-06', 'seed-lead-14', 'seed-lead-22'] } },
    data: { status: LeadStatus.BOOKING_CREATED, convertedToBookingId: 'Có booking liên kết trong dữ liệu seed.' },
  });

  return bookings;
}

async function createPaymentsAndReceipts(bookings: BookingSeed[]) {
  const paymentRows: Array<{
    id: string;
    bookingIndex: number;
    type: PaymentType;
    method: PaymentMethod;
    status: PaymentStatus;
    amount: number;
    paid: number;
    refunded?: number;
    rentalAmount?: number;
    depositAmount?: number;
    securityDepositAmount?: number;
    damageAmount?: number;
    otherFees?: number;
    refundAmount?: number;
    description: string;
    receiptType?: ReceiptType;
    transactionStatus?: PaymentTransactionStatus;
    gateway?: PaymentGateway;
  }> = [
    { id: 'booking-deposit-01', bookingIndex: 1, type: PaymentType.BOOKING_DEPOSIT, method: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.PENDING, amount: 360000, paid: 0, depositAmount: 360000, description: 'Khách chuyển khoản cọc giữ lịch, đang chờ ngân hàng xác nhận.' },
    { id: 'booking-deposit-02', bookingIndex: 2, type: PaymentType.BOOKING_DEPOSIT, method: PaymentMethod.MOMO, status: PaymentStatus.COMPLETED, amount: 420000, paid: 420000, depositAmount: 420000, description: 'Khách chuyển khoản cọc giữ lịch.', receiptType: ReceiptType.DEPOSIT_RECEIPT, transactionStatus: PaymentTransactionStatus.SUCCESS, gateway: PaymentGateway.MOMO },
    { id: 'rental-payment-01', bookingIndex: 3, type: PaymentType.RENTAL_PAYMENT, method: PaymentMethod.CASH, status: PaymentStatus.COMPLETED, amount: 980000, paid: 980000, rentalAmount: 980000, description: 'Thu đủ tiền thuê khi xác nhận booking.', receiptType: ReceiptType.RENTAL_RECEIPT, transactionStatus: PaymentTransactionStatus.SUCCESS, gateway: PaymentGateway.MANUAL },
    { id: 'security-deposit-01', bookingIndex: 5, type: PaymentType.SECURITY_DEPOSIT, method: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.COMPLETED, amount: 500000, paid: 500000, securityDepositAmount: 500000, description: 'Thu cọc bảo đảm khi bàn giao váy.', receiptType: ReceiptType.DEPOSIT_RECEIPT, transactionStatus: PaymentTransactionStatus.SUCCESS, gateway: PaymentGateway.PAYOS },
    { id: 'rental-payment-02', bookingIndex: 6, type: PaymentType.RENTAL_PAYMENT, method: PaymentMethod.CASH, status: PaymentStatus.COMPLETED, amount: 1560000, paid: 1560000, rentalAmount: 1560000, description: 'Thu đủ tiền thuê khi bàn giao.', receiptType: ReceiptType.RENTAL_RECEIPT },
    { id: 'dirty-hold-01', bookingIndex: 7, type: PaymentType.FEE, method: PaymentMethod.CASH, status: PaymentStatus.PROCESSING, amount: 500000, paid: 500000, otherFees: 500000, description: 'Giữ lại 500k do váy bị dơ, hẹn hoàn sau 24h.', receiptType: ReceiptType.RETURN_RECEIPT, transactionStatus: PaymentTransactionStatus.PROCESSING, gateway: PaymentGateway.MANUAL },
    { id: 'damage-fee-01', bookingIndex: 7, type: PaymentType.FEE, method: PaymentMethod.CASH, status: PaymentStatus.COMPLETED, amount: 300000, paid: 300000, damageAmount: 300000, description: 'Thu phí xử lý vết rách nhỏ ở lớp lót.', receiptType: ReceiptType.RETURN_RECEIPT },
    { id: 'refund-01', bookingIndex: 8, type: PaymentType.REFUND, method: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.REFUNDED, amount: 500000, paid: 0, refunded: 500000, refundAmount: 500000, description: 'Hoàn cọc đầy đủ sau khi kiểm tra váy sạch.', receiptType: ReceiptType.REFUND_RECEIPT, transactionStatus: PaymentTransactionStatus.SUCCESS, gateway: PaymentGateway.PAYOS },
    { id: 'failed-01', bookingIndex: 9, type: PaymentType.BOOKING_DEPOSIT, method: PaymentMethod.MOMO, status: PaymentStatus.FAILED, amount: 300000, paid: 0, depositAmount: 300000, description: 'Giao dịch cọc thất bại do ví điện tử từ chối.' },
    { id: 'accessory-fee-01', bookingIndex: 11, type: PaymentType.FEE, method: PaymentMethod.CASH, status: PaymentStatus.PARTIALLY_REFUNDED, amount: 250000, paid: 250000, refunded: 100000, otherFees: 250000, description: 'Thu phí phụ kiện thiếu, quản lý duyệt hoàn lại một phần.', receiptType: ReceiptType.RETURN_RECEIPT },
    { id: 'late-fee-01', bookingIndex: 12, type: PaymentType.FEE, method: PaymentMethod.CASH, status: PaymentStatus.COMPLETED, amount: 220000, paid: 220000, otherFees: 220000, description: 'Khách trả trễ 2 ngày, đã thu phụ phí.', receiptType: ReceiptType.RETURN_RECEIPT },
    { id: 'rental-payment-processing', bookingIndex: 16, type: PaymentType.RENTAL_PAYMENT, method: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.PROCESSING, amount: 1280000, paid: 0, rentalAmount: 1280000, description: 'Đang chờ ngân hàng xác nhận tiền thuê trước khi bàn giao.', transactionStatus: PaymentTransactionStatus.PENDING, gateway: PaymentGateway.PAYOS },
    { id: 'booking-deposit-03', bookingIndex: 17, type: PaymentType.BOOKING_DEPOSIT, method: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.COMPLETED, amount: 400000, paid: 400000, depositAmount: 400000, description: 'Khách đã cọc giữ lịch qua chuyển khoản.', receiptType: ReceiptType.DEPOSIT_RECEIPT },
    { id: 'refund-02', bookingIndex: 18, type: PaymentType.REFUND, method: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.REFUNDED, amount: 350000, paid: 0, refunded: 350000, refundAmount: 350000, description: 'Hoàn tiền do khách hủy trước hạn theo chính sách.', receiptType: ReceiptType.REFUND_RECEIPT },
  ];

  for (const row of paymentRows) {
    const booking = bookings[row.bookingIndex];
    const rentalId = `seed-rental-${String(row.bookingIndex + 1).padStart(2, '0')}`;
    const paymentId = `seed-payment-${row.id}`;
    await prisma.payment.create({
      data: {
        id: paymentId,
        rentalId,
        bookingId: booking.id,
        status: row.status,
        type: row.type,
        amount: row.amount,
        amountPaid: row.paid,
        amountRefunded: row.refunded ?? 0,
        paymentMethod: row.method,
        externalTransactionId: row.status === PaymentStatus.COMPLETED || row.status === PaymentStatus.REFUNDED ? `GD-${row.id.toUpperCase()}` : undefined,
        rentalAmount: row.rentalAmount ?? 0,
        depositAmount: row.depositAmount ?? 0,
        securityDepositAmount: row.securityDepositAmount ?? 0,
        damageAmount: row.damageAmount ?? 0,
        otherFees: row.otherFees ?? 0,
        refundAmount: row.refundAmount ?? 0,
        description: row.description,
        processedById: row.status === PaymentStatus.PENDING ? undefined : staff(UserRole.CASHIER),
        paidAt: includesValue([PaymentStatus.COMPLETED, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED], row.status) ? day(-1, 15) : undefined,
      },
    });

    if (row.receiptType) {
      await prisma.receipt.create({
        data: {
          id: `seed-receipt-${row.id}`,
          paymentId,
          receiptNumber: `LUM-${row.receiptType.replace('_', '-')}-${String(paymentRows.indexOf(row) + 1).padStart(3, '0')}`,
          type: row.receiptType,
          pdfUrl: `/receipts/lum-${row.id}.pdf`,
          createdById: staff(UserRole.CASHIER),
          printedAt: day(-1, 16),
          printedCount: row.receiptType === ReceiptType.RETURN_RECEIPT ? 2 : 1,
        },
      });
    }

    if (row.transactionStatus || row.gateway) {
      await prisma.paymentTransaction.create({
        data: {
          id: `seed-transaction-${row.id}`,
          paymentId,
          provider: row.gateway ?? PaymentGateway.MANUAL,
          status: row.transactionStatus ?? PaymentTransactionStatus.SUCCESS,
          amount: row.amount,
          currency: 'VND',
          checkoutUrl: row.gateway === PaymentGateway.PAYOS ? `https://pay.demo/lumiere/${row.id}` : undefined,
          providerTransactionId: `NCC-${row.id}`,
          idempotencyKey: `seed-${row.id}`,
          metadata: JSON.stringify({ ghiChu: row.description, kenh: row.method }),
          paidAt: row.transactionStatus === PaymentTransactionStatus.SUCCESS ? day(-1, 15) : undefined,
        },
      });
    }
  }
}

async function createReturnInspections(bookings: BookingSeed[]) {
  const inspectableBookings = bookings
    .map((booking, index) => ({ booking, index }))
    .filter(({ booking }) => booking.rentalStatus)
    .slice(0, 10);

  const conditions = ['good', 'dirty', 'damaged', 'incomplete'];
  const notes = [
    'Váy sạch, hoàn cọc đầy đủ.',
    'Váy có vết makeup phần ngực, giữ cọc 24h để xử lý.',
    'Khách trả trễ 2 ngày, đã thu phụ phí.',
    'Thiếu belt đi kèm, ghi nhận phí phụ kiện.',
    'Đường lai váy bị bung nhẹ, chuyển bộ phận may kiểm tra.',
  ];

  for (let i = 0; i < inspectableBookings.length; i += 1) {
    const { index } = inspectableBookings[i];
    await prisma.returnInspection.create({
      data: {
        id: `seed-return-inspection-${String(i + 1).padStart(2, '0')}`,
        rentalId: `seed-rental-${String(index + 1).padStart(2, '0')}`,
        condition: conditions[i % conditions.length],
        imageUrls: JSON.stringify([`/returns/seed-return-${i + 1}-front.jpg`, `/returns/seed-return-${i + 1}-detail.jpg`]),
        notes: notes[i % notes.length],
        suggestedFee: conditions[i % conditions.length] === 'good' ? 0 : [150000, 300000, 250000][i % 3],
        inspectedById: staff(UserRole.OPERATOR, i % 2),
      },
    });
  }
}

async function createAppointments(bookings: BookingSeed[]) {
  const appointmentNotes = [
    'Hẹn tư vấn chọn váy theo concept tiệc cưới.',
    'Hẹn thử váy cho khách, chuẩn bị 2 size gần nhau.',
    'Khách đến nhận váy, cần kiểm tra QR và phụ kiện.',
    'Khách trả váy và kiểm tra tình trạng sau thuê.',
    'Lịch hẹn bị hủy do khách đổi ngày sự kiện.',
  ];

  await prisma.appointment.createMany({
    data: Array.from({ length: 20 }).map((_, index) => {
      const type = [AppointmentType.CONSULTATION, AppointmentType.FITTING, AppointmentType.PICKUP, AppointmentType.RETURN][index % 4];
      const status = [AppointmentStatus.SCHEDULED, AppointmentStatus.CHECKED_IN, AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED][index % 4];
      const booking = bookings[index % bookings.length];
      return {
        id: `seed-appointment-${String(index + 1).padStart(2, '0')}`,
        customerId: customers[index % customers.length][0],
        type,
        status,
        scheduledAt: day(index - 5, 9 + (index % 9), index % 2 ? 30 : 0),
        startTime: day(index - 5, 9 + (index % 9), index % 2 ? 30 : 0),
        endTime: day(index - 5, 10 + (index % 9), index % 2 ? 15 : 45),
        durationMinutes: type === AppointmentType.CONSULTATION ? 45 : 60,
        room: type === AppointmentType.PICKUP ? 'Quầy bàn giao' : type === AppointmentType.RETURN ? 'Quầy nhận trả' : `Phòng thử ${1 + (index % 3)}`,
        notes: appointmentNotes[index % appointmentNotes.length],
        staffId: type === AppointmentType.PICKUP || type === AppointmentType.RETURN ? staff(UserRole.OPERATOR, index % 2) : staff(UserRole.SALES, index % 2),
        leadId: index < 12 ? `seed-lead-${String(index + 1).padStart(2, '0')}` : undefined,
        bookingId: type === AppointmentType.PICKUP || type === AppointmentType.RETURN ? booking.id : undefined,
        resourceItemId: type === AppointmentType.PICKUP || type === AppointmentType.RETURN ? booking.itemId : undefined,
        lifecycleStatus: status === AppointmentStatus.CANCELLED ? 'Đã hủy' : status === AppointmentStatus.COMPLETED ? 'Hoàn tất' : 'Đang theo dõi',
      };
    }),
  });
}

async function createPreviewRequests(bookings: BookingSeed[]) {
  const previewNotes = [
    'Khách muốn xem thử form váy đỏ.',
    'Đã nhận ảnh mặt, đang xử lý preview.',
    'Preview lỗi do ảnh mờ, yêu cầu khách gửi lại.',
    'Khách muốn so sánh hai mẫu trước khi đặt lịch thử.',
  ];

  await prisma.previewRequest.createMany({
    data: Array.from({ length: 12 }).map((_, index) => {
      const status = [PreviewRequestStatus.PENDING, PreviewRequestStatus.PROCESSING, PreviewRequestStatus.COMPLETED, PreviewRequestStatus.REJECTED][index % 4];
      const booking = bookings[index % bookings.length];
      return {
        id: `seed-preview-${String(index + 1).padStart(2, '0')}`,
        customerId: customers[index % customers.length][0],
        leadId: index < 8 ? `seed-lead-${String(index + 1).padStart(2, '0')}` : undefined,
        bookingId: index % 3 === 0 ? booking.id : undefined,
        garmentName: productDefs[index % productDefs.length][1],
        sourceImageUrl: `/preview/source-${index + 1}.jpg`,
        resultImageUrl: status === PreviewRequestStatus.COMPLETED ? `/preview/result-${index + 1}.jpg` : undefined,
        status,
        notes: previewNotes[index % previewNotes.length],
        resultNotes: status === PreviewRequestStatus.COMPLETED ? 'Preview đạt, stylist đề xuất khách thử trực tiếp để kiểm tra vai và chiều dài.' : status === PreviewRequestStatus.REJECTED ? 'Ảnh khách gửi bị mờ, không đủ điều kiện tạo preview.' : undefined,
        assignedToId: index % 2 === 0 ? staff(UserRole.SALES) : staff(UserRole.OPERATOR),
      };
    }),
  });
}

async function createDisputes(bookings: BookingSeed[]) {
  const rows = [
    ['DSP-001', 'Khách không đồng ý phí vệ sinh', DisputeCategory.CLEANING_FEE, DisputeStatus.OPEN, 'Khách cho rằng vết makeup đã có từ trước khi nhận váy.', 500000, 0],
    ['DSP-002', 'Phí hư hỏng lớp lót váy', DisputeCategory.DAMAGE_FEE, DisputeStatus.IN_REVIEW, 'Váy bị bung lai sau khi trả, cần đối chiếu ảnh bàn giao.', 300000, 0],
    ['DSP-003', 'Thiếu phụ kiện clutch bạc', DisputeCategory.MISSING_ACCESSORY, DisputeStatus.WAITING_ON_CUSTOMER, 'Khách báo phụ kiện đã thiếu từ trước, shop yêu cầu gửi ảnh lúc nhận.', 250000, 0],
    ['DSP-004', 'Khách không đồng ý phí trả trễ', DisputeCategory.LATE_FEE, DisputeStatus.WAITING_ON_MANAGER, 'Khách trả trễ 2 ngày do mưa lớn, cần quản lý quyết định giảm phí.', 220000, 100000],
    ['DSP-005', 'Trùng lịch giữ váy cưới', DisputeCategory.BOOKING_TERMS, DisputeStatus.RESOLVED, 'Hai booking giữ cùng một item, shop đã đổi mẫu tương đương và giảm giá.', 400000, 200000],
    ['DSP-006', 'Hoàn tiền do giao váy trễ', DisputeCategory.REFUND, DisputeStatus.RESOLVED, 'Shop không giao được váy đúng lịch, đã duyệt hoàn tiền một phần.', 600000, 600000],
    ['DSP-007', 'Thanh toán chuyển khoản bị treo', DisputeCategory.PAYMENT, DisputeStatus.REJECTED, 'Ngân hàng xác nhận giao dịch chưa thành công, yêu cầu khách chuyển lại.', 350000, 0],
    ['DSP-008', 'Cần quản lý rà soát thủ công', DisputeCategory.OTHER, DisputeStatus.CANCELLED, 'Khách đã tự hủy yêu cầu sau khi nhận giải thích chính sách.', 0, 0],
  ] as const;

  for (let index = 0; index < rows.length; index += 1) {
    const [caseNumber, title, category, status, summary, requestedAmount, approvedAmount] = rows[index];
    const booking = bookings[(index + 7) % bookings.length];
    const disputeId = `seed-dispute-${String(index + 1).padStart(2, '0')}`;
    const resolved = includesValue([DisputeStatus.RESOLVED, DisputeStatus.REJECTED, DisputeStatus.CANCELLED], status);
    await prisma.dispute.create({
      data: {
        id: disputeId,
        caseNumber,
        title,
        category,
        priority: index < 2 ? DisputePriority.HIGH : index === 5 ? DisputePriority.CRITICAL : DisputePriority.MEDIUM,
        status,
        summary,
        customerPosition: 'Khách yêu cầu shop kiểm tra lại ảnh bàn giao và chính sách phí.',
        internalNotes: 'Nhân viên đã gom ảnh trước/sau thuê, lịch sử thanh toán và ghi chú bàn giao.',
        requestedAmount,
        approvedAmount,
        bookingId: booking.id,
        rentalId: booking.rentalStatus ? `seed-rental-${String(((index + 7) % bookings.length) + 1).padStart(2, '0')}` : undefined,
        inventoryItemId: booking.itemId,
        assignedToId: staff(UserRole.MANAGER),
        createdById: staff(UserRole.OPERATOR),
        resolvedById: resolved ? staff(UserRole.MANAGER) : undefined,
        resolutionOutcome: status === DisputeStatus.RESOLVED ? (approvedAmount > 0 ? DisputeResolutionOutcome.CUSTOMER_REFUND : DisputeResolutionOutcome.FEE_UPHELD) : undefined,
        resolutionSummary: resolved ? 'Đã xử lý theo chính sách cửa hàng và cập nhật khách qua Zalo.' : undefined,
        resolvedAt: resolved ? day(-1, 17) : undefined,
        dueAt: day(index % 3, 17),
      },
    });

    await prisma.disputeEvidence.create({
      data: {
        id: `seed-dispute-evidence-${String(index + 1).padStart(2, '0')}`,
        disputeId,
        fileName: `bang-chung-${caseNumber}.jpg`,
        fileUrl: `/disputes/${caseNumber}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: 420000 + index * 12000,
        evidenceType: 'Ảnh tình trạng trang phục',
        note: 'Ảnh được chụp tại quầy nhận trả và lưu để đối chiếu.',
        uploadedById: staff(UserRole.OPERATOR),
      },
    });
  }
}

async function createRentalOrders(productSeeds: ProductSeed[]) {
  for (let index = 0; index < 6; index += 1) {
    const product = productSeeds[index % productSeeds.length];
    const inventoryItemId = product.itemIds[product.itemIds.length - 1];
    await prisma.rentalOrder.create({
      data: {
        id: `seed-rental-order-${String(index + 1).padStart(2, '0')}`,
        orderCode: `RO-2026-${String(index + 1).padStart(3, '0')}`,
        customerId: customers[(index + 20) % customers.length][0],
        status: [RentalOrderStatus.DRAFT, RentalOrderStatus.PENDING_CONFIRMATION, RentalOrderStatus.CONFIRMED, RentalOrderStatus.PREPARING, RentalOrderStatus.PICKED_UP, RentalOrderStatus.RETURNED][index],
        paymentStatus: [RentalOrderPaymentStatus.UNPAID, RentalOrderPaymentStatus.PARTIALLY_PAID, RentalOrderPaymentStatus.PAID, RentalOrderPaymentStatus.PARTIALLY_PAID, RentalOrderPaymentStatus.PAID, RentalOrderPaymentStatus.REFUNDED][index],
        startDateTime: day(index + 1, 9),
        endDateTime: day(index + 2, 18),
        quantity: 1,
        durationHours: 33,
        subtotal: product.price,
        depositAmount: 500000,
        additionalFees: index === 3 ? 120000 : 0,
        discountAmount: index === 5 ? 150000 : 0,
        totalAmount: product.price + 500000 + (index === 3 ? 120000 : 0) - (index === 5 ? 150000 : 0),
        notes: 'Đơn thuê nhanh từ client, cần xác nhận tình trạng item trước khi giữ lịch.',
        createdById: staff(UserRole.SALES),
        items: {
          create: {
            id: `seed-rental-order-item-${String(index + 1).padStart(2, '0')}`,
            productId: product.id,
            inventoryItemId,
            quantity: 1,
            unitPrice: product.price,
            notes: 'Item đề xuất theo tình trạng khả dụng hiện tại.',
          },
        },
      },
    });
  }
}

async function createDashboardData() {
  await prisma.calendarBlock.createMany({
    data: [
      {
        id: 'seed-calendar-maintenance-01',
        inventoryItemId: 'seed-item-p004-4',
        reason: 'Khóa lưng hơi lỏng, cần kiểm tra và may lại trước booking cuối tuần.',
        startDate: day(-1, 9),
        endDate: day(2, 18),
      },
      {
        id: 'seed-calendar-cleaning-01',
        inventoryItemId: 'seed-item-p008-4',
        reason: 'Váy có vết makeup, đang giặt hấp xử lý chuyên sâu.',
        startDate: day(0, 8),
        endDate: day(1, 14),
      },
    ],
  });

  await prisma.dailyReport.createMany({
    data: Array.from({ length: 7 }).map((_, index) => ({
      id: `seed-daily-report-${index + 1}`,
      reportDate: day(index - 6, 0),
      totalRevenue: money(4200000 + index * 680000),
      paymentsCount: 6 + index,
      bookingsCount: 3 + (index % 4),
      pickupsCount: 2 + (index % 3),
      returnsCount: 1 + (index % 3),
    })),
  });

  await prisma.notification.createMany({
    data: [
      { id: 'seed-notification-01', userId: staff(UserRole.MANAGER), title: 'Có dispute đang chờ xử lý', message: 'DSP-004 cần quản lý phê duyệt giảm phí trả trễ.', type: 'in-app', read: false },
      { id: 'seed-notification-02', userId: staff(UserRole.CASHIER), title: 'Thanh toán đang xử lý', message: 'Có giao dịch chuyển khoản đang chờ ngân hàng xác nhận.', type: 'in-app', read: false },
      { id: 'seed-notification-03', userId: staff(UserRole.OPERATOR), title: 'Item cần bảo trì', message: 'Váy dự tiệc đính đá ánh bạc cần kiểm tra khóa lưng.', type: 'in-app', read: false },
    ],
  });
}

async function createAuditLogs(bookings: BookingSeed[]) {
  const rows = [
    [AuditAction.CREATE, 'Lead', 'seed-lead-03', 'Nhân viên tư vấn đã tạo lead từ Facebook.'],
    [AuditAction.STATUS_CHANGE, 'Lead', 'seed-lead-04', 'Nhân viên tư vấn đã yêu cầu cọc 50%.'],
    [AuditAction.PAYMENT_POSTED, 'Payment', 'seed-payment-booking-deposit-02', 'Thu ngân ghi nhận khách chuyển khoản cọc giữ lịch.'],
    [AuditAction.PAYMENT_PROCESSED, 'Payment', 'seed-payment-rental-payment-01', 'Thu ngân xác nhận thanh toán tiền thuê.'],
    [AuditAction.INVENTORY_LOCKED, 'Booking', bookings[2].id, 'Hệ thống khóa item sau khi nhận cọc booking.'],
    [AuditAction.PICKUP_CONFIRMED, 'Rental', 'seed-rental-06', 'Nhân viên vận hành bàn giao item QR-P006-002.'],
    [AuditAction.RETURN_INSPECTED, 'ReturnInspection', 'seed-return-inspection-02', 'Nhân viên vận hành kiểm tra váy có vết makeup phần ngực.'],
    [AuditAction.RETURN_SETTLED, 'Rental', 'seed-rental-08', 'Quản lý duyệt hoàn cọc sau khi kiểm tra tình trạng.'],
    [AuditAction.DISPUTE_OPENED, 'Dispute', 'seed-dispute-01', 'Nhân viên mở dispute vì khách không đồng ý phí vệ sinh.'],
    [AuditAction.DISPUTE_RESOLVED, 'Dispute', 'seed-dispute-06', 'Quản lý phê duyệt hoàn tiền dispute DSP-006.'],
    [AuditAction.UPDATE, 'ClientSettings', 'client-settings', 'Quản trị cập nhật nội dung trang chủ client bằng tiếng Việt.'],
    [AuditAction.ARCHIVE, 'User', 'seed-user-cashier-backup', 'Quản trị vô hiệu hóa tài khoản thu ngân dự phòng.'],
  ] as const;

  await prisma.auditLog.createMany({
    data: rows.map(([action, entity, entityId, summary], index) => ({
      id: `seed-audit-${String(index + 1).padStart(2, '0')}`,
      action,
      entity,
      entityId,
      label: summary,
      summary,
      before: { trangThai: index % 2 === 0 ? 'trước cập nhật' : 'đang xử lý' },
      after: { trangThai: index % 2 === 0 ? 'sau cập nhật' : 'đã ghi nhận' },
      metadata: { ngonNguHienThi: 'vi', nguCanh: 'Dữ liệu demo seed cho hệ thống cho thuê trang phục.' },
      actorId: index % 3 === 0 ? staff(UserRole.SALES) : index % 3 === 1 ? staff(UserRole.CASHIER) : staff(UserRole.MANAGER),
      bookingId: entity === 'Booking' ? entityId : undefined,
      rentalId: entity === 'Rental' ? entityId : undefined,
      paymentId: entity === 'Payment' ? entityId : undefined,
      inventoryItemId: undefined,
      returnInspectionId: entity === 'ReturnInspection' ? entityId : undefined,
      disputeId: entity === 'Dispute' ? entityId : undefined,
      createdAt: day(index - 3, 8 + index),
    })),
  });
}

async function createClientSettings() {
  const clientSettings = {
    brandingJson: {
      logoUrl: '',
      faviconUrl: '/favicon.ico',
      brandName: 'Lumière Dress Studio',
      tagline: 'Studio cho thuê váy và trang phục cao cấp',
      accentPreset: 'champagne black',
      heroImage: 'https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?auto=format&fit=crop&w=2200&q=92',
    },
    homepageJson: {
      announcementEnabled: true,
      announcementText: 'Ưu đãi lịch thử váy riêng trong tuần này cho khách đặt trước qua Zalo.',
      heroTitle: 'Thuê váy cao cấp cho những dịp đặc biệt',
      heroSubtitle: 'Chọn mẫu phù hợp, giữ lịch nhanh, thử váy linh hoạt tại cửa hàng và nhận tư vấn styling cá nhân.',
      ctaText: 'Xem bộ sưu tập',
      featuredSections: ['Váy dạ hội mới về', 'Váy cưới chụp ảnh', 'Áo dài tốt nghiệp', 'Vest nam sự kiện'],
      editorialBlocks: ['Mỗi thiết kế đều được kiểm tra form, phụ kiện và tình trạng trước khi bàn giao.', 'Không cần thanh toán toàn bộ online. Khách có thể thử váy trước khi quyết định.'],
    },
    catalogJson: {
      defaultSort: 'editorial',
      visibleFilters: ['Tìm kiếm', 'Danh mục', 'Ngày lấy', 'Ngày trả', 'Size', 'Màu'],
      categoryOrder: ['Váy dạ hội', 'Váy cưới', 'Đầm dự tiệc', 'Áo dài', 'Vest nam', 'Phụ kiện'],
      showUnavailableItems: false,
      badgeLogic: 'Hiển thị nhãn còn lịch, có preview AI và mức phí thuê theo ngày.',
      quickActionsEnabled: true,
    },
    productDetailJson: {
      sectionOrder: ['Thư viện ảnh', 'Thông tin mẫu', 'Chọn ngày thuê', 'Ghi chú stylist', 'Preview AI', 'Chính sách thuê'],
      showStylistNote: true,
      showMeasurements: true,
      showFabrics: true,
      relatedProductsMode: 'same category',
      relatedProductsLimit: 4,
      rentalNoteBlock: 'Giá thuê cuối cùng, cọc bảo đảm và tình trạng mẫu sẽ được xác nhận sau khi cửa hàng kiểm tra lịch trống.',
    },
    inquiryJson: {
      enabledFields: ['Họ tên', 'Số điện thoại', 'Email', 'Ngày sự kiện', 'Ghi chú styling'],
      requiredFields: ['Họ tên', 'Số điện thoại', 'Ngày sự kiện'],
      helperText: 'Hãy cho chúng tôi biết ngày sự kiện, phong cách mong muốn và khung giờ bạn có thể ghé thử.',
      trustBlock: ['Không bắt buộc thanh toán toàn bộ online', 'Được thử váy tại cửa hàng trước khi chốt thuê'],
      pickupNote: 'Khách vui lòng kiểm tra QR, phụ kiện và tình trạng váy khi nhận.',
      depositNote: 'Cọc giữ lịch thường là 50% phí thuê, cọc bảo đảm được hoàn sau khi kiểm tra trả váy.',
      shippingNote: 'Giao nhận nội thành được xác nhận riêng theo khu vực và độ an toàn của mẫu.',
    },
    previewJson: {
      enabled: true,
      acceptedFileInfo: 'Ảnh chân dung chính diện, đủ sáng, định dạng JPG hoặc PNG.',
      disclaimer: 'Preview AI chỉ hỗ trợ hình dung phom dáng, không thay thế buổi thử váy trực tiếp.',
      reviewCopy: 'Stylist sẽ xem tỷ lệ vai, eo, chiều dài và đề xuất size phù hợp.',
      turnaroundNote: 'Preview thường được phản hồi trong vòng 1 ngày làm việc.',
    },
    navigationJson: {
      topNavItems: [
        { label: 'Bộ sưu tập', href: '/products', visible: true },
        { label: 'Preview AI', href: '/products/demo/preview', visible: true },
        { label: 'Đặt lịch thử váy', href: '/checkout', visible: true },
      ],
    },
    footerJson: {
      contactEmail: 'studio@lumiere.vn',
      hotline: '0901 000 888',
      zalo: 'Lumière Dress Studio',
      address: '42 Nguyễn Trãi, Quận 1, TP. Hồ Chí Minh',
      socialLinks: [
        { label: 'Instagram', href: 'https://instagram.com/lumiere.dress', visible: true },
        { label: 'Facebook', href: 'https://facebook.com/lumiere.dress', visible: true },
        { label: 'TikTok', href: 'https://tiktok.com/@lumiere.dress', visible: true },
      ],
      footerLinks: [
        { label: 'Chính sách thuê', href: '/policies/rental', visible: true },
        { label: 'Chính sách cọc', href: '/policies/deposit', visible: true },
        { label: 'Liên hệ stylist', href: '/checkout', visible: true },
      ],
    },
    seoJson: {
      siteTitleTemplate: '%s | Lumière Dress Studio',
      metaDescription: 'Thuê váy cao cấp, váy cưới, áo dài, vest và phụ kiện sự kiện tại TP. Hồ Chí Minh.',
      ogImage: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1600&q=90',
    },
    i18nJson: {
      enabledLocales: ['vi', 'en'],
      defaultLocale: 'vi',
      fallbackLocale: 'vi',
    },
    policiesJson: {
      rentalPolicy: 'Thời gian thuê tiêu chuẩn từ 2 đến 4 ngày. Mọi lịch thuê cần được cửa hàng xác nhận tình trạng mẫu trước khi giữ lịch.',
      depositPolicy: 'Cọc giữ lịch không hoàn nếu khách hủy sát ngày theo chính sách. Cọc bảo đảm được hoàn sau khi váy được kiểm tra đầy đủ.',
      pickupPolicy: 'Khi nhận váy, khách kiểm tra QR, phụ kiện, tình trạng vải, khóa kéo và ký xác nhận bàn giao.',
      returnPolicy: 'Khách trả váy đúng thời gian đã hẹn. Trả trễ có thể phát sinh phụ phí theo số ngày và lịch booking tiếp theo.',
      shippingPolicy: 'Giao nhận nội thành chỉ áp dụng với mẫu đủ điều kiện vận chuyển an toàn và được xác nhận riêng.',
      damagePolicy: 'Vết bẩn nặng, hư hỏng, mất phụ kiện hoặc sửa chữa phát sinh sẽ được trừ vào cọc bảo đảm theo chi phí thực tế.',
    },
    updatedBy: 'Nguyễn Minh Quân',
    updatedAt: now.toISOString(),
    publishedAt: now.toISOString(),
  };

  await prisma.siteSetting.createMany({
    data: [
      {
        key: 'homepage',
        value: JSON.stringify({
          heroImage: clientSettings.brandingJson.heroImage,
          heroEyebrow: 'Lumière Dress Studio',
          heroTitle: clientSettings.homepageJson.heroTitle,
          heroCopy: clientSettings.homepageJson.heroSubtitle,
          heroCta: clientSettings.homepageJson.ctaText,
          editorial1Eyebrow: 'Dịch vụ thử váy riêng',
          editorial1Title: 'Mỗi mẫu váy được chuẩn bị như một buổi fitting cá nhân.',
          editorial1Copy: 'Stylist hỗ trợ chọn dáng váy, kiểm tra size và xác nhận phụ kiện trước khi khách quyết định thuê.',
          editorialCta: 'Đặt lịch thử váy',
          storyTitle: 'Từ tiệc cưới, gala đến chụp ảnh, cửa hàng luôn có phương án thay thế an toàn.',
          storyCta: 'Xem bộ sưu tập',
          editorial2Eyebrow: 'Quy trình thuê rõ ràng',
          editorial2Title: 'Giữ lịch nhanh, bàn giao bằng QR, hoàn cọc minh bạch.',
          editorial2Copy: 'Mọi giao dịch đều có lịch sử thanh toán, biên lai và ảnh tình trạng trước sau thuê.',
          breakEyebrow: 'Chính sách an tâm',
          breakTitle: 'Thử váy trước khi chốt thuê.',
          breakCta: 'Liên hệ stylist',
        }),
      },
      { key: 'client-settings', value: JSON.stringify(clientSettings) },
      {
        key: 'rbac-roles',
        value: JSON.stringify({
          super_admin: { label: roleLabelVi.SUPER_ADMIN, permissions: ['*'] },
          manager: { label: roleLabelVi.MANAGER, permissions: ['dashboard.read', 'booking.read', 'payment.refund', 'dispute.resolve', 'user.read'] },
          sales: { label: roleLabelVi.SALES, permissions: ['lead.create', 'lead.update', 'appointment.create', 'booking.create'] },
          operator: { label: roleLabelVi.OPERATOR, permissions: ['scan.operate', 'pickup.confirm', 'return.inspect', 'inventory.status_update'] },
          cashier: { label: roleLabelVi.CASHIER, permissions: ['payment.create', 'payment.process', 'payment.refund', 'receipt.print'] },
        }),
      },
    ],
  });
}

async function main() {
  await resetDatabase();
  await createUsers();
  await createCustomers();
  const productSeeds = await createProductsAndInventory();
  await createLeads(productSeeds);
  const bookings = await createBookings(productSeeds);
  await createPaymentsAndReceipts(bookings);
  await createReturnInspections(bookings);
  await createAppointments(bookings);
  await createPreviewRequests(bookings);
  await createDisputes(bookings);
  await createRentalOrders(productSeeds);
  await createDashboardData();
  await createAuditLogs(bookings);
  await createClientSettings();

  console.log('Seed tiếng Việt hoàn tất.');
  console.log(`Users: ${users.length}, customers: ${customers.length}, products: ${productDefs.length}, bookings: ${bookings.length}`);
  console.log(`Tài khoản demo: ${users.map((user) => user.email).join(', ')}`);
  console.log(`Mật khẩu chung: ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
