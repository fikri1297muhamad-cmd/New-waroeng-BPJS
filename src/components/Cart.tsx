
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
    <section className="fixed bottom-0 left-0 right-0 z-20 max-h-[38dvh] border-t border-green-100 bg-white/95 shadow-[0_-5px_24px_rgba(0,0,0,0.10)] backdrop-blur-sm">
      <div className="mx-auto flex w-full min-h-0 max-w-5xl flex-col px-4 pb-3 pt-3 sm:px-6 sm:pb-4">

        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold text-green-900 sm:text-base">
              Keranjang Pesanan
            </h2>

            <p className="mt-0.5 text-[11px] text-gray-500 sm:text-xs">
              {totalQuantity} item · {items.length} jenis menu
            </p>
          </div>

          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
            {items.length} Menu
          </span>
        </div>

        {items.length === 0 ? (
          <div className="shrink-0 rounded-xl bg-gray-50 px-3 py-3 text-center">
            <p className="text-sm font-medium text-gray-500">
              Keranjang masih kosong.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Pilih menu favorit untuk mulai memesan.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
            {items.map((item) => (
              <div
                key={item.menu.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-800">
                    {item.menu.name}
                  </p>

                  <p className="mt-0.5 text-xs text-gray-500">
                    {rupiah(item.menu.price)} × {item.quantity}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRemove(item.menu.id)}
                    aria-label={`Kurangi ${item.menu.name}`}
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-lg font-bold text-gray-700 transition hover:bg-gray-100 active:scale-95"
                  >
                    −
                  </button>

                  <span className="min-w-5 text-center text-sm font-extrabold text-gray-800">
                    {item.quantity}
                  </span>

                  <button
                    type="button"
                    onClick={() => onAdd(item.menu)}
                    aria-label={`Tambah ${item.menu.name}`}
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-800 text-lg font-bold text-white transition hover:bg-green-900 active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex shrink-0 items-center justify-between gap-3 border-t border-green-100 pt-3">
          <div>
            <p className="text-xs font-medium text-gray-500">
              Total Pembayaran
            </p>
            <p className="mt-0.5 text-lg font-extrabold text-green-900 sm:text-xl">
              {rupiah(total)}
            </p>
          </div>

          <span className="rounded-xl bg-green-50 px-3 py-2 text-xs font-bold text-green-800 sm:text-sm">
            Pembayaran di Kasir
          </span>
        </div>

      </div>
    </section>
  );
}
