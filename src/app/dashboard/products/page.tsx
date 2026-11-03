import type { Metadata } from "next";
import { Package, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { site } from "@/config/site";
import { PRIMARY_BUTTON_CLASS, ROW_ACTION_CLASS } from "@/components/form-message";
import { Badge } from "@/components/owner/badge";
import { Card } from "@/components/owner/card";
import { SavedToast } from "@/components/owner/saved-toast";
import { formatIdr } from "@/lib/format-idr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { setProductActiveAction } from "@/features/products/actions";
import { listProducts, type Product } from "@/features/products/repository";

export const metadata: Metadata = { title: `Produk — ${site.name}` };

const SAVED_NOTICES = new Map<unknown, string>([
  ["created", "Produk ditambahkan."],
  ["updated", "Perubahan produk tersimpan."],
]);

function CostSummary({ product }: { product: Product }) {
  if (product.variableCostIdr === null) {
    return <Badge tone="warning">Biaya belum diketahui</Badge>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
      Biaya {formatIdr(product.variableCostIdr)}
      {product.costQuality === "estimated" && <Badge tone="warning">Biaya estimasi</Badge>}
    </span>
  );
}

function ProductRow({ product }: { product: Product }) {
  return (
    <li className="flex flex-wrap items-center gap-4 p-4 sm:px-6">
      {product.photoUrl ? (
        <Image
          src={product.photoUrl}
          alt=""
          width={64}
          height={64}
          unoptimized
          className="size-16 shrink-0 rounded-[10px] border border-line object-cover"
        />
      ) : (
        <div aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-muted">
          <Package size={20} strokeWidth={1.5} />
        </div>
      )}
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
          <span className="break-words">{product.name}</span>
          {!product.isActive && <Badge tone="neutral">Nonaktif</Badge>}
        </p>
        <p className="mt-1 text-base text-ink">{formatIdr(product.basePriceIdr)}</p>
        <div className="mt-1">
          <CostSummary product={product} />
        </div>
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Link href={`/dashboard/products/${product.id}`} className={`flex-1 sm:flex-none ${ROW_ACTION_CLASS}`}>
          Ubah
        </Link>
        <form action={setProductActiveAction} className="flex flex-1 sm:flex-none">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="version" value={product.version} />
          <input type="hidden" name="isActive" value={String(!product.isActive)} />
          <button type="submit" className={`w-full ${ROW_ACTION_CLASS}`}>
            {product.isActive ? "Nonaktifkan" : "Aktifkan"}
          </button>
        </form>
      </div>
    </li>
  );
}

export default async function ProductsPage({ searchParams }: PageProps<"/dashboard/products">) {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const [products, { saved }] = await Promise.all([listProducts(supabase, businessId), searchParams]);
  const savedMessage = SAVED_NOTICES.get(saved);

  return (
    <div className="flex flex-col gap-6">
      {savedMessage && <SavedToast message={savedMessage} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[65ch]">
          <h1 className="text-2xl font-bold text-ink">Produk</h1>
          <p className="mt-1 text-base text-muted">Produk nonaktif tidak bisa dipakai untuk preorder baru.</p>
        </div>
        <Link href="/dashboard/products/new" className={`gap-2 ${PRIMARY_BUTTON_CLASS}`}>
          <Plus aria-hidden size={18} strokeWidth={1.5} />
          Tambah produk
        </Link>
      </div>

      {products.length === 0 ? (
        <Card>
          <p className="text-base text-muted">Belum ada produk. Tambahkan produk pertama beserta harga dan biayanya.</p>
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {products.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
