import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { site } from "@/config/site";
import { formatIdr } from "@/lib/format-idr";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireBusinessOwner } from "@/features/business/guard";
import { setProductActiveAction } from "@/features/products/actions";
import { listProducts, type Product } from "@/features/products/repository";
import { COST_QUALITY_LABELS } from "@/features/products/schemas";

export const metadata: Metadata = { title: `Produk — ${site.name}` };

const ADD_LINK_CLASS =
  "inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-hover";
const ROW_ACTION_CLASS =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-xs! font-medium! text-ink transition hover:bg-subtle";

function costLabel(product: Product): string {
  if (product.variableCostIdr === null) return "Biaya belum diketahui";
  return `Biaya ${formatIdr(product.variableCostIdr)} (${COST_QUALITY_LABELS[product.costQuality].toLowerCase()})`;
}

function ProductRow({ product }: { product: Product }) {
  return (
    <li className="flex flex-wrap items-center gap-4 p-4">
      {product.photoUrl ? (
        <Image
          src={product.photoUrl}
          alt=""
          width={64}
          height={64}
          unoptimized
          className="size-16 shrink-0 rounded-lg border border-line object-cover"
        />
      ) : (
        <div aria-hidden className="size-16 shrink-0 rounded-lg border border-line bg-subtle" />
      )}
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <span className="break-words">{product.name}</span>
          {!product.isActive && (
            <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-muted">Nonaktif</span>
          )}
        </p>
        <p className="mt-1 text-sm text-ink">{formatIdr(product.basePriceIdr)}</p>
        <p className="text-xs text-muted">{costLabel(product)}</p>
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/dashboard/products/${product.id}`} className={ROW_ACTION_CLASS}>
          Ubah
        </Link>
        <form action={setProductActiveAction}>
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="version" value={product.version} />
          <input type="hidden" name="isActive" value={String(!product.isActive)} />
          <button type="submit" className={ROW_ACTION_CLASS}>
            {product.isActive ? "Nonaktifkan" : "Aktifkan"}
          </button>
        </form>
      </div>
    </li>
  );
}

export default async function ProductsPage() {
  const { businessId } = await requireBusinessOwner();
  const supabase = await createSupabaseServerClient();
  const products = await listProducts(supabase, businessId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Produk</h1>
          <p className="mt-1 text-sm text-muted">Produk nonaktif tidak bisa dipakai untuk preorder baru.</p>
        </div>
        <Link href="/dashboard/products/new" className={ADD_LINK_CLASS}>
          Tambah produk
        </Link>
      </div>

      {products.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          Belum ada produk. Tambahkan produk pertama beserta harga dan biayanya.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {products.map((product) => (
            <ProductRow key={product.id} product={product} />
          ))}
        </ul>
      )}
    </div>
  );
}
