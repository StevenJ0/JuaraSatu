import { isPaymentOverdue, type FulfillmentStatus, type OrderStatus, type PaymentState } from "@/features/orders/status";

/**
 * Status pesanan untuk pemegang token privat (FR-PAY-06). Field disebut satu per satu dan sengaja seminimal mungkin:
 * token bisa bocor lewat riwayat browser, jadi nama, email, kontak, alasan batal, dan biaya tidak ikut.
 */
export type PrivateOrderStatus = {
  publicOrderNumber: string;
  /** `expired` juga berlaku bila tenggat bayar sudah lewat walau statusnya belum dirapikan, karena slotnya memang sudah dilepas. */
  orderStatus: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** Terpisah dari status pesanan. Ini simulasi sandbox, bukan uang sungguhan, dan halaman pembeli wajib menyatakannya. */
  paymentState: PaymentState;
  paymentDueAt: string | null;
  businessName: string;
  preorderName: string;
  productName: string;
  quantity: number;
  baseUnitPriceIdr: number;
  discountPerUnitIdr: number;
  finalUnitPriceIdr: number;
  subtotalIdr: number;
  discountTotalIdr: number;
  totalIdr: number;
  fulfillmentDate: string;
  fulfillmentWindowEndAt: string;
  /** Ketentuan yang dibekukan saat preorder terbit, sehingga tidak berubah walau profil usaha diubah. */
  pickup: { instructions: string; publicContact: string | null };
  asOf: string;
};

export function toPrivateOrderStatus(
  facts: Omit<PrivateOrderStatus, "asOf">,
  now: Date,
): PrivateOrderStatus {
  const isOverdue = isPaymentOverdue({ ...facts, externalPaymentStatus: null }, now);
  return {
    publicOrderNumber: facts.publicOrderNumber,
    orderStatus: isOverdue ? "expired" : facts.orderStatus,
    fulfillmentStatus: facts.fulfillmentStatus,
    paymentState: facts.paymentState,
    paymentDueAt: facts.paymentDueAt,
    businessName: facts.businessName,
    preorderName: facts.preorderName,
    productName: facts.productName,
    quantity: facts.quantity,
    baseUnitPriceIdr: facts.baseUnitPriceIdr,
    discountPerUnitIdr: facts.discountPerUnitIdr,
    finalUnitPriceIdr: facts.finalUnitPriceIdr,
    subtotalIdr: facts.subtotalIdr,
    discountTotalIdr: facts.discountTotalIdr,
    totalIdr: facts.totalIdr,
    fulfillmentDate: facts.fulfillmentDate,
    fulfillmentWindowEndAt: facts.fulfillmentWindowEndAt,
    pickup: { instructions: facts.pickup.instructions, publicContact: facts.pickup.publicContact },
    asOf: now.toISOString(),
  };
}
