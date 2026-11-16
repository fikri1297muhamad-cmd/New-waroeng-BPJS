
import type { MenuItem } from '../types';

type CartItem = {
  menu: MenuItem;
  quantity: number;
};

type Props = {
  items: CartItem[];
  onAdd: (menu: MenuItem) => void;
  onRemove: (menuId: string) => void;
};

const rupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);

export default function Cart({
  items,
  onAdd,
  onRemove
}: Props) {
  const total = items.reduce(
    (sum, item) => sum + item.menu.price * item.quantity,
    0
  );

  const totalQuantity = items.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  return (
    <section className="fixed inset-x-0 bottom-0 z-30 flex h-[30dvh] min-h-[150px] max-h-[230px] flex-col border-t border-green-100 bg-white px-3 pb-[max(6px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-5px_20px_rgba(0,0,0,0.08)] sm:px-5">

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">

        <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-extrabold text-green-900">
              Keranjang Pesanan
            </h2>

            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-800">
              {totalQuantity} item
            </span>
          </div>

          <span className="shrink-0 text-[10px] text-gray-500">
            {items.length} jenis menu
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {items.length === 0 ? (
            <p className="py-2 text-xs text-gray-500">
              Belum ada pesanan.
            </p>
          ) : (
            <div className="space-y-1">
              {items.map((item) => (
                <div
                  key={item.menu.id}
                  className="flex min-h-9 items-center justify-between gap-2 border-b border-gray-100 py-1"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-gray-800">
                      {item.menu.name}
                    </p>

                    <p className="text-[10px] text-gray-500">
                      {rupiah(item.menu.price)} × {item.quantity}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Kurangi ${item.menu.name}`}
                      onClick={() => onRemove(item.menu.id)}
                      className="grid h-7 w-7 place-items-center rounded-full bg-gray-100 text-sm font-bold text-gray-700"
                    >
                      −
                    </button>

                    <span className="min-w-3 text-center text-xs font-bold">
                      {item.quantity}
                    </span>

                    <button
                      type="button"
                      aria-label={`Tambah ${item.menu.name}`}
                      onClick={() => onAdd(item.menu)}
                      className="grid h-7 w-7 place-items-center rounded-full bg-green-800 text-sm font-bold text-white"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-1 flex shrink-0 items-center justify-between gap-3 border-t border-green-100 bg-white pt-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-gray-700">
              Total Pembayaran
            </p>

            <p className="text-[9px] text-gray-500">
              Bayar di kasir
            </p>
          </div>

          <span className="shrink-0 text-base font-extrabold text-green-800 sm:text-lg">
            {rupiah(total)}
          </span>
        </div>

      </div>
    </section>
  );
}
